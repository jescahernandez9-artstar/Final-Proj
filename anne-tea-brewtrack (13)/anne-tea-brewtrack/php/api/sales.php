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
    $date = $_GET['date'] ?? date('Y-m-d');
    $stmt = $pdo->prepare("
        SELECT s.*, u.full_name AS cashier
        FROM sales s
        JOIN users u ON u.id = s.user_id
        WHERE DATE(s.created_at) = ? AND s.status = 'completed'
        ORDER BY s.created_at DESC
    ");
    $stmt->execute([$date]);
    $sales = $stmt->fetchAll();
    jsonResponse(['sales' => $sales]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $items = $input['items'] ?? [];
    $method = $input['payment_method'] ?? 'Cash';
    $total  = floatval($input['total'] ?? 0);

    if (empty($items) || $total <= 0) {
        jsonResponse(['error' => 'Invalid sale data'], 400);
    }

    $pdo->beginTransaction();
    try {
        $txnNo = 'AT' . date('YmdHis') . rand(100, 999);
        $stmt = $pdo->prepare("
            INSERT INTO sales (transaction_no, user_id, payment_method, subtotal, total_amount, status)
            VALUES (?, ?, ?, ?, ?, 'completed')
        ");
        $stmt->execute([$txnNo, $auth['uid'], $method, $total, $total]);
        $saleId = $pdo->lastInsertId();

        $itemStmt = $pdo->prepare("
            INSERT INTO sale_items (sale_id, product_id, product_name, size_code, unit_price, quantity, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");

        // deduct inventory via recipes
        $recipeStmt = $pdo->prepare("
            SELECT r.ingredient_id, r.quantity_used, i.name
            FROM recipes r
            JOIN ingredients i ON i.id = r.ingredient_id
            WHERE r.product_id = ?
        ");
        $updateStock = $pdo->prepare("UPDATE ingredients SET current_stock = current_stock - ? WHERE id = ?");
        $logStmt = $pdo->prepare("
            INSERT INTO stock_logs (ingredient_id, change_qty, reason, reference_id, user_id)
            VALUES (?, ?, 'sale', ?, ?)
        ");

        foreach ($items as $it) {
            $itemStmt->execute([
                $saleId,
                $it['product_id'] ?? 0,
                $it['name'],
                $it['size'] ?? 'REG',
                $it['price'],
                $it['qty'],
                $it['price'] * $it['qty']
            ]);

            if (!empty($it['product_id'])) {
                $recipeStmt->execute([$it['product_id']]);
                while ($r = $recipeStmt->fetch()) {
                    $used = $r['quantity_used'] * $it['qty'];
                    $updateStock->execute([$used, $r['ingredient_id']]);
                    $logStmt->execute([$r['ingredient_id'], -$used, $saleId, $auth['uid']]);
                }
            }
        }

        $pdo->commit();
        jsonResponse(['success' => true, 'transaction_no' => $txnNo, 'sale_id' => $saleId]);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => $e->getMessage()], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
