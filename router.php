<?php
$url = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// If requesting an API endpoint
if (strpos($url, '/api/') === 0) {
  $file = __DIR__ . '/../' . ltrim($url, '/');
  if (file_exists($file) && is_file($file)) {
    // Execute the API file
    $_GET = $_REQUEST = [];
    $_SERVER['SCRIPT_FILENAME'] = $file;
    require_once $file;
    exit;
  }
  http_response_code(404);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'API endpoint not found']);
  exit;
}

// For static files (HTML, CSS, JS, etc), return false to let PHP serve normally
return false;
