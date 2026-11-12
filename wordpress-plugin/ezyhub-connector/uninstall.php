<?php
/**
 * Beim Löschen des Plugins: EzyRank-Optionen und -Transients entfernen.
 * Beiträge und Bilder bleiben unverändert (Kap. 7.11).
 */

if (!defined('WP_UNINSTALL_PLUGIN')) exit;

foreach ([
    'ezyrank_key_hash', 'ezyrank_key_created', 'ezyrank_key_last4', 'ezyrank_scope_publish',
    'ezyrank_default_author', 'ezyrank_log', 'ezyrank_last_ok', 'ezyrank_last_error', 'ezyrank_indexnow_key',
] as $opt) {
    delete_option($opt);
}

global $wpdb;
$wpdb->query(
    "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_ezyrank\\_%' OR option_name LIKE '\\_transient\\_timeout\\_ezyrank\\_%'"
);
