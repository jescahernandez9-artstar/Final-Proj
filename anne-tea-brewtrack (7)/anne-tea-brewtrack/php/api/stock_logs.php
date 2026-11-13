<?php
require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    exit;
}

$auth = requireAuth();
$pdo  = getPDO();

$limit = min(100, intval($_GET['limit'] ?? 50));
$rows = $pdo->query("
    SELECT l.*, i.name AS ingredient_name, u.full_name AS user_name
    FROM stock_logs l
    JOIN ingredients i ON i.id = l.ingredient_id
    JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT $limit
")->fetchAll();

jsonResponse(['logs' => $rows]);
