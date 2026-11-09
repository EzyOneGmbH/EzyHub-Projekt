<?php
/**
 * EzyRank-Modul des EzyHub Connectors (ab 2.0): Blog-Autopilot.
 * Lädt die Klassen und hängt sie an WordPress.
 */

if (!defined('ABSPATH')) exit;

// Fester EzyHub-Host (Pull-Modus, Links) und erlaubter Bild-Speicher.
// Überschreibbar nur in wp-config.php, nie aus einer Anfrage.
if (!defined('EZYRANK_API_HOST')) define('EZYRANK_API_HOST', 'ezyhub.ch');
if (!defined('EZYRANK_STORAGE_HOST')) define('EZYRANK_STORAGE_HOST', 'glrgccmujzuwnhyvwxyi.supabase.co');

require_once __DIR__ . '/class-ezyrank-logger.php';
require_once __DIR__ . '/class-ezyrank-auth.php';
require_once __DIR__ . '/class-ezyrank-sanitizer.php';
require_once __DIR__ . '/class-ezyrank-seo.php';
require_once __DIR__ . '/class-ezyrank-media.php';
require_once __DIR__ . '/class-ezyrank-posts.php';
require_once __DIR__ . '/class-ezyrank-rest.php';

class EzyRank_Plugin {
    public static function init() {
        add_action('rest_api_init', ['EzyRank_Rest', 'register']);
        add_filter('pre_get_document_title', ['EzyRank_Seo', 'filter_title'], 100);
        add_action('wp_head', ['EzyRank_Seo', 'meta_description'], 2);
        add_action('wp_head', ['EzyRank_Seo', 'jsonld'], 20);
        $admin = dirname(__DIR__, 2) . '/admin/class-ezyrank-admin.php';
        if (is_admin() && file_exists($admin)) {
            require_once $admin;
            EzyRank_Admin::init();
        }
    }
}
