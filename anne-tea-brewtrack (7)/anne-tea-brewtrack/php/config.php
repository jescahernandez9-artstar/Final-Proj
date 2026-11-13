<?php
/**
 * AnneTea BrewTrack - Database & App Config
 * Production domain: https://annetea.com
 * Change DB credentials for your hosting panel (cPanel, etc.)
 */

define('APP_URL', 'https://annetea.com');
define('APP_NAME', 'AnneTea BrewTrack');

define('DB_HOST', '127.0.0.1');   // on most shared hosts this stays 127.0.0.1
define('DB_NAME', 'annetea_brewtrack');
define('DB_USER', 'root');
define('DB_PASS', '');            // set your real DB password on hosting
define('DB_CHARSET', 'utf8mb4');

define('JWT_SECRET', 'change-this-to-a-long-random-string-in-production-2026');
define('SESSION_HOURS', 8);

function getPDO() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    echo json_encode($data);
    exit;
}

function requireAuth() {
    $headers = getallheaders();
    $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (!preg_match('/Bearer\s+(\S+)/', $auth, $m)) {
        jsonResponse(['error' => 'Unauthorized'], 401);
    }
    $token = $m[1];
    $parts = explode('.', $token);
    if (count($parts) !== 2) jsonResponse(['error' => 'Invalid token'], 401);
    $payload = json_decode(base64_decode($parts[0]), true);
    $sig = hash_hmac('sha256', $parts[0], JWT_SECRET);
    if (!hash_equals($sig, $parts[1]) || ($payload['exp'] ?? 0) < time()) {
        jsonResponse(['error' => 'Token expired'], 401);
    }
    return $payload;
}

function makeToken($user) {
    $payload = [
        'uid'  => $user['id'],
        'user' => $user['username'],
        'role' => $user['role'],
        'name' => $user['full_name'],
        'exp'  => time() + (SESSION_HOURS * 3600)
    ];
    $body = base64_encode(json_encode($payload));
    $sig  = hash_hmac('sha256', $body, JWT_SECRET);
    return $body . '.' . $sig;
}
