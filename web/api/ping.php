<?php
// Health check for deploys: is PHP running, is curl available, is the relay configured.
declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store');

$configured = false;
$provider = null;
$path = __DIR__ . '/_private/config.php';
if (is_file($path)) {
    $config = require $path;
    $configured = ($config['api_key'] ?? '') !== '';
    $provider = $config['provider'] ?? null;
}

echo json_encode([
    'ok' => true,
    'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
    'curl' => function_exists('curl_init'),
    'provider' => $provider,
    'keySet' => $configured,
]);
