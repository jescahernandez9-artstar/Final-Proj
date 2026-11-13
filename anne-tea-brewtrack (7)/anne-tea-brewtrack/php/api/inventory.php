<?php
require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    exit;
}

$auth = requireAuth();
$pdo  = getPDO();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $pdo->query("
        SELECT id, name, unit, current_stock, min_stock, expiry_date,
               CASE WHEN current_stock <= min_stock THEN 1 ELSE 0 END AS is_low
        FROM ingredients
        ORDER BY is_low DESC, name
    ")->fetchAll();
    jsonResponse(['inventory' => $rows]);
}

// Restock / Adjust
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $id     = intval($input['ingredient_id'] ?? 0);
    $qty    = floatval($input['quantity'] ?? 0);   // positive = add
    $reason = $input['reason'] ?? 'restock';       // restock | adjustment | waste
    $notes  = $input['notes'] ?? '';

    if (!$id || $qty == 0) {
        jsonResponse(['error' => 'ingredient_id and quantity required'], 400);
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE ingredients SET current_stock = current_stock + ? WHERE id = ?")
            ->execute([$qty, $id]);
        $pdo->prepare("
            INSERT INTO stock_logs (ingredient_id, change_qty, reason, user_id, notes)
            VALUES (?, ?, ?, ?, ?)
        ")->execute([$id, $qty, $reason, $auth['uid'], $notes]);
        $pdo->commit();
        jsonResponse(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => $e->getMessage()], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
