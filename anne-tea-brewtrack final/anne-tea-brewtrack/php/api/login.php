<?php
require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$username = strtolower(trim($input['username'] ?? ''));
$password = $input['password'] ?? '';

if (!$username || !$password) {
    jsonResponse(['success' => false, 'message' => 'Username and password required'], 400);
}

$pdo = getPDO();
$stmt = $pdo->prepare('SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ? LIMIT 1');
$stmt->execute([$username]);
$user = $stmt->fetch();

if (!$user || !$user['is_active'] || !password_verify($password, $user['password_hash'])) {
    jsonResponse(['success' => false, 'message' => 'Invalid credentials'], 401);
}

// update last login
$pdo->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$user['id']]);

$token = makeToken($user);
jsonResponse([
    'success' => true,
    'token'   => $token,
    'user'    => [
        'id'       => $user['id'],
        'username' => $user['username'],
        'name'     => $user['full_name'],
        'role'     => $user['role']
    ]
]);
