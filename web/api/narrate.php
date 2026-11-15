<?php
// Relay from the phone page to the LLM, so the API key never reaches the phone.
// The phone sends {system, messages: [{role: user|assistant, content: string}]}.
// Everything that costs money (provider, model, output cap) is fixed here.
//
// The reply is streamed back as server-sent events in one provider-neutral shape:
//   data: {"type":"text","text":"..."}
//   data: {"type":"done","stop":"...","usage":{"in":123,"out":456}}
//   data: {"type":"error","message":"..."}
// Errors before streaming starts come back as JSON {error} with an HTTP status.
//
// Providers: "gemini" (Google Gemini API) and "anthropic" (Claude), chosen by
// LLM_PROVIDER in .env, which the deploy script writes into the config.
declare(strict_types=1);

$config = require __DIR__ . '/_private/config.php';

header('Cache-Control: no-cache, no-store');
header('X-Content-Type-Options: nosniff');

function fail(int $status, string $message)
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only');
if ($config['access_token'] === '' || !hash_equals($config['access_token'], $_SERVER['HTTP_X_ACCESS_TOKEN'] ?? '')) {
    fail(401, 'wrong or missing access token');
}
$provider = $config['provider'];
if (!in_array($provider, ['gemini', 'anthropic'], true)) fail(500, 'unknown provider in config');
if ($config['api_key'] === '') fail(503, 'relay has no API key configured');

$raw = file_get_contents('php://input', false, null, 0, $config['max_body_bytes'] + 1);
if ($raw === false || strlen($raw) > $config['max_body_bytes']) fail(413, 'request too large');
$in = json_decode($raw, true);
if (!is_array($in) || !is_string($in['system'] ?? null) || !is_array($in['messages'] ?? null) || $in['messages'] === []) {
    fail(400, 'expected {system: string, messages: [...]}');
}
foreach ($in['messages'] as $m) {
    if (!is_array($m) || !in_array($m['role'] ?? null, ['user', 'assistant'], true) || !is_string($m['content'] ?? null)) {
        fail(400, 'each message needs a role (user or assistant) and string content');
    }
}

// Daily call limit, counted in a small file next to the config.
$counter = __DIR__ . '/_private/calls-' . gmdate('Y-m-d') . '.txt';
$fh = fopen($counter, 'c+');
if ($fh === false) fail(500, 'cannot open the call counter');
flock($fh, LOCK_EX);
$calls = (int) stream_get_contents($fh);
if ($calls >= $config['daily_calls']) {
    flock($fh, LOCK_UN);
    fail(429, 'daily call limit reached');
}
ftruncate($fh, 0);
rewind($fh);
fwrite($fh, (string) ($calls + 1));
flock($fh, LOCK_UN);
fclose($fh);

if ($provider === 'gemini') {
    $generation = ['maxOutputTokens' => $config['max_tokens']];
    if ($config['thinking'] !== '') $generation['thinkingConfig'] = ['thinkingLevel' => $config['thinking']];
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($config['model']) . ':streamGenerateContent?alt=sse';
    $headers = ['content-type: application/json', 'x-goog-api-key: ' . $config['api_key']];
    $body = [
        'systemInstruction' => ['parts' => [['text' => $in['system']]]],
        'contents' => array_map(
            fn(array $m): array => ['role' => $m['role'] === 'assistant' ? 'model' : 'user', 'parts' => [['text' => $m['content']]]],
            $in['messages'],
        ),
        'generationConfig' => $generation,
    ];
} else {
    $url = 'https://api.anthropic.com/v1/messages';
    $headers = [
        'content-type: application/json',
        'x-api-key: ' . $config['api_key'],
        'anthropic-version: 2023-06-01',
        'anthropic-beta: server-side-fallback-2026-07-01',
    ];
    $body = [
        'model' => $config['model'],
        'max_tokens' => $config['max_tokens'],
        'system' => $in['system'],
        'messages' => $in['messages'],
        'output_config' => ['effort' => 'low'],
        'fallbacks' => 'default',
        'stream' => true,
    ];
}

// Pass the stream through as it arrives: no output buffering or compression.
@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
while (ob_get_level() > 0) ob_end_flush();
ob_implicit_flush(true);
set_time_limit(120);

function emit(array $event): void
{
    echo 'data: ' . json_encode($event, JSON_UNESCAPED_UNICODE) . "\n\n";
    flush();
}

$state = ['started' => false, 'ok' => false, 'buffer' => '', 'errorBody' => '', 'stop' => null, 'in' => null, 'out' => null];

/** Turns one upstream event into zero or more neutral events. */
function handle(string $provider, array $msg, array &$state): void
{
    if ($provider === 'gemini') {
        if (isset($msg['error'])) {
            emit(['type' => 'error', 'message' => (string) ($msg['error']['message'] ?? 'Gemini error')]);
            return;
        }
        $candidate = $msg['candidates'][0] ?? [];
        foreach ($candidate['content']['parts'] ?? [] as $part) {
            if (isset($part['text']) && empty($part['thought'])) emit(['type' => 'text', 'text' => $part['text']]);
        }
        if (isset($candidate['finishReason'])) $state['stop'] = $candidate['finishReason'];
        if (isset($msg['usageMetadata'])) {
            $state['in'] = $msg['usageMetadata']['promptTokenCount'] ?? $state['in'];
            $state['out'] = $msg['usageMetadata']['candidatesTokenCount'] ?? $state['out'];
        }
        return;
    }
    switch ($msg['type'] ?? '') {
        case 'content_block_delta':
            if (($msg['delta']['type'] ?? '') === 'text_delta') emit(['type' => 'text', 'text' => $msg['delta']['text']]);
            break;
        case 'message_start':
            $state['in'] = $msg['message']['usage']['input_tokens'] ?? null;
            break;
        case 'message_delta':
            $state['stop'] = $msg['delta']['stop_reason'] ?? $state['stop'];
            $state['out'] = $msg['usage']['output_tokens'] ?? $state['out'];
            break;
        case 'error':
            emit(['type' => 'error', 'message' => (string) ($msg['error']['message'] ?? 'Claude error')]);
            break;
    }
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($body),
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 110,
    CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$state, $provider): int {
        if (!$state['started']) {
            $state['started'] = true;
            $state['ok'] = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
            if ($state['ok']) {
                header('Content-Type: text/event-stream');
                header('X-Accel-Buffering: no');
                header('X-LiteSpeed-Cache-Control: no-cache');
            }
        }
        if (!$state['ok']) {
            if (strlen($state['errorBody']) < 8192) $state['errorBody'] .= $chunk;
            return strlen($chunk);
        }
        $state['buffer'] = str_replace("\r\n", "\n", $state['buffer'] . $chunk);
        while (($i = strpos($state['buffer'], "\n\n")) !== false) {
            $event = substr($state['buffer'], 0, $i);
            $state['buffer'] = substr($state['buffer'], $i + 2);
            foreach (explode("\n", $event) as $line) {
                if (strncmp($line, 'data:', 5) !== 0) continue;
                $msg = json_decode(trim(substr($line, 5)), true);
                if (is_array($msg)) handle($provider, $msg, $state);
            }
        }
        return strlen($chunk);
    },
]);
$ok = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if (!$state['started']) fail(502, 'could not reach the LLM API: ' . $curlError);
if (!$state['ok']) {
    $err = json_decode($state['errorBody'], true);
    $message = $err['error']['message'] ?? (is_string($err['error'] ?? null) ? $err['error'] : trim($state['errorBody']));
    fail($status === 429 ? 429 : 502, "$provider returned $status: $message");
}
if ($ok === false) emit(['type' => 'error', 'message' => 'stream interrupted: ' . $curlError]);
emit(['type' => 'done', 'stop' => $state['stop'], 'usage' => ['in' => $state['in'], 'out' => $state['out']]]);
