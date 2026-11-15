<?php
// Relay from the phone page to the Claude Messages API, so the API key never
// reaches the phone. The phone sends {system, messages}; everything that costs
// money (model, output cap, effort) is fixed here. The streamed reply (server-sent
// events) is passed through to the phone unchanged.
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
if ($config['anthropic_api_key'] === '') fail(503, 'relay has no API key configured');

$raw = file_get_contents('php://input', false, null, 0, $config['max_body_bytes'] + 1);
if ($raw === false || strlen($raw) > $config['max_body_bytes']) fail(413, 'request too large');
$in = json_decode($raw, true);
if (!is_array($in) || !is_string($in['system'] ?? null) || !is_array($in['messages'] ?? null) || $in['messages'] === []) {
    fail(400, 'expected {system: string, messages: [...]}');
}
foreach ($in['messages'] as $m) {
    if (!is_array($m) || !in_array($m['role'] ?? null, ['user', 'assistant'], true) || !isset($m['content'])) {
        fail(400, 'each message needs a role (user or assistant) and content');
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

$body = json_encode([
    'model' => $config['model'],
    'max_tokens' => $config['max_tokens'],
    'system' => $in['system'],
    'messages' => $in['messages'],
    'output_config' => ['effort' => 'low'],
    'fallbacks' => 'default',
    'stream' => true,
]);

// Pass the stream through as it arrives: no output buffering or compression.
@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
while (ob_get_level() > 0) ob_end_flush();
ob_implicit_flush(true);
set_time_limit(120);

$started = false;
$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'content-type: application/json',
        'x-api-key: ' . $config['anthropic_api_key'],
        'anthropic-version: 2023-06-01',
        'anthropic-beta: server-side-fallback-2026-07-01',
    ],
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 110,
    CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$started): int {
        if (!$started) {
            $started = true;
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            http_response_code($status ?: 502);
            if ($status === 200) {
                header('Content-Type: text/event-stream');
                header('X-Accel-Buffering: no');
                header('X-LiteSpeed-Cache-Control: no-cache');
            } else {
                header('Content-Type: application/json');
            }
        }
        echo $chunk;
        flush();
        return strlen($chunk);
    },
]);
$ok = curl_exec($ch);
if ($ok === false && !$started) fail(502, 'could not reach the Claude API: ' . curl_error($ch));
curl_close($ch);
