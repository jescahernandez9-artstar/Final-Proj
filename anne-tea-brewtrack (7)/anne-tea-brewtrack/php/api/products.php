<?php
require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    exit;
}

$auth = requireAuth();
$pdo  = getPDO();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $cats = $pdo->query("SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order")->fetchAll();
    $prods = $pdo->query("
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        ORDER BY c.sort_order, p.name
    ")->fetchAll();

    $prices = $pdo->query("SELECT * FROM product_prices")->fetchAll();
    $priceMap = [];
    foreach ($prices as $pr) {
        $priceMap[$pr['product_id']][$pr['size_code']] = (float)$pr['price'];
    }
    foreach ($prods as &$p) {
        $p['prices'] = $priceMap[$p['id']] ?? [];
    }

    jsonResponse(['categories' => $cats, 'products' => $prods]);
}

// Create / Update product (owner only)
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT'])) {
    if (!in_array($auth['role'], ['owner', 'co_owner'])) {
        jsonResponse(['error' => 'Forbidden'], 403);
    }
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $id   = intval($input['id'] ?? 0);
    $name = trim($input['name'] ?? '');
    $cat  = intval($input['category_id'] ?? 0);
    $prices = $input['prices'] ?? [];

    if (!$name || !$cat) {
        jsonResponse(['error' => 'name and category_id required'], 400);
    }

    if ($id) {
        $pdo->prepare("UPDATE products SET name = ?, category_id = ?, is_bestseller = ?, is_favorite = ? WHERE id = ?")
            ->execute([$name, $cat, !empty($input['is_bestseller']) ? 1 : 0, !empty($input['is_favorite']) ? 1 : 0, $id]);
    } else {
        $pdo->prepare("INSERT INTO products (category_id, name, is_bestseller, is_favorite) VALUES (?, ?, ?, ?)")
            ->execute([$cat, $name, !empty($input['is_bestseller']) ? 1 : 0, !empty($input['is_favorite']) ? 1 : 0]);
        $id = $pdo->lastInsertId();
    }

    // upsert prices
    $pdo->prepare("DELETE FROM product_prices WHERE product_id = ?")->execute([$id]);
    $ins = $pdo->prepare("INSERT INTO product_prices (product_id, size_code, price) VALUES (?, ?, ?)");
    foreach ($prices as $size => $price) {
        if ($price > 0) $ins->execute([$id, $size, $price]);
    }

    jsonResponse(['success' => true, 'id' => $id]);
}

jsonResponse(['error' => 'Method not allowed'], 405);
