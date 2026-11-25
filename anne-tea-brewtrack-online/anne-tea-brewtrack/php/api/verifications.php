<?php
/**
 * Identity verification records.
 * GET  -> latest records (owner / co-owner)
 * POST -> save a record (owner / co-owner). No images or face data are accepted or stored.
 */
require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    exit;
}

$auth = requireAuth();
if (!in_array($auth['role'] ?? '', ['owner', 'co_owner'], true)) {
    jsonResponse(['error' => 'Forbidden'], 403);
}
$pdo = getPDO();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $pdo->query("SELECT id, user_id, status, id_type, id_number_masked, full_name, age,
                                ocr_confidence, face_distance, face_attempts, edited_fields,
                                fail_reasons, verified_by, created_at
                         FROM identity_verifications ORDER BY created_at DESC LIMIT 100")->fetchAll();
    jsonResponse(['verifications' => $rows]);
}

$b = json_decode(file_get_contents('php://input'), true) ?: [];
$status = $b['status'] ?? '';
if (empty($b['id']) || !in_array($status, ['verified', 'failed'], true)) {
    jsonResponse(['error' => 'Invalid record'], 400);
}
$types = ['philsys', 'driver', 'passport', 'umid'];
$stmt = $pdo->prepare("INSERT IGNORE INTO identity_verifications
    (id, status, id_type, id_number_masked, id_number_hash, full_name, date_of_birth, age, address,
     expiry_date, ocr_confidence, face_distance, face_attempts, edited_fields, fail_reasons, verified_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
$stmt->execute([
    substr($b['id'], 0, 24), $status,
    in_array($b['idType'] ?? '', $types, true) ? $b['idType'] : null,
    substr($b['idNumberMasked'] ?? '', 0, 40),
    ($status === 'verified' && !empty($b['idNumberHash'])) ? substr($b['idNumberHash'], 0, 64) : null,
    substr($b['fullName'] ?? '', 0, 120),
    !empty($b['dob']) ? $b['dob'] : null,
    isset($b['age']) ? intval($b['age']) : null,
    substr($b['address'] ?? '', 0, 255),
    !empty($b['expiry']) ? $b['expiry'] : null,
    intval($b['ocrConfidence'] ?? 0),
    isset($b['faceDistance']) ? floatval($b['faceDistance']) : null,
    intval($b['faceAttempts'] ?? 0),
    substr(implode(',', $b['editedFields'] ?? []), 0, 120),
    substr(implode(' | ', $b['reasons'] ?? []), 0, 2000),
    $auth['user'] ?? null,
]);
jsonResponse(['ok' => true], 201);
