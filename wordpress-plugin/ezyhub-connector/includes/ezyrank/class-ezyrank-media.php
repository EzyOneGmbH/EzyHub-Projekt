<?php
/**
 * Bilder in die Mediathek laden (Kap. 7.5 Punkt 5). Bild-URLs nur von der
 * EzyHub-Storage-Domain (Konstante EZYRANK_STORAGE_HOST, überschreibbar nur in
 * wp-config.php) oder bereits vorhandene Bilder der eigenen Mediathek (ab 2.0.1,
 * ohne neuen Upload). Gleiche Quelle (URL ohne Query/Signatur) wird
 * wiederverwendet statt erneut hochgeladen.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Media {
    const TYPES = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'];

    public static function host_allowed($url) {
        $p = wp_parse_url((string) $url);
        if (!is_array($p) || ($p['scheme'] ?? '') !== 'https' || empty($p['host'])) return false;
        return strtolower($p['host']) === strtolower(EZYRANK_STORAGE_HOST);
    }

    /** Gehört die URL zur eigenen Website (mit/ohne www)? */
    public static function own_host($url) {
        $h = strtolower((string) wp_parse_url((string) $url, PHP_URL_HOST));
        $own = strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST));
        $norm = function ($x) { return preg_replace('/^www\./', '', $x); };
        return $h !== '' && $own !== '' && $norm($h) === $norm($own);
    }

    /**
     * Bild aus der eigenen Mediathek (URL der eigenen Website, auch
     * Grössenvariante «-800x600») → Attachment-ID, ohne erneuten Upload.
     */
    public static function own_attachment($url) {
        $clean = strtok((string) $url, '?');
        $id = (int) attachment_url_to_postid($clean);
        if (!$id) {
            $full = preg_replace('/-\d+x\d+(\.[a-z0-9]+)$/i', '$1', $clean);
            if ($full !== $clean) $id = (int) attachment_url_to_postid($full);
        }
        if (!$id) {
            // «-scaled» (WordPress verkleinert grosse Uploads)
            $scaled = preg_replace('/(\.[a-z0-9]+)$/i', '-scaled$1', preg_replace('/-\d+x\d+(\.[a-z0-9]+)$/i', '$1', $clean));
            $id = (int) attachment_url_to_postid($scaled);
        }
        return $id && wp_attachment_is_image($id) ? $id : 0;
    }

    /** Liefert Attachment-ID oder WP_Error(ezr_image_failed). */
    public static function sideload($url, $alt, $parent_id = 0) {
        $url = (string) $url;
        if (self::own_host($url)) {
            $id = self::own_attachment($url);
            if (!$id) {
                return new WP_Error('ezr_image_failed', 'Bild der eigenen Website ist nicht in der Mediathek.', ['status' => 422]);
            }
            // Bestehenden Alt-Text des Kunden nicht überschreiben
            if ($alt !== null && $alt !== '' && get_post_meta($id, '_wp_attachment_image_alt', true) === '') {
                update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field($alt));
            }
            return $id;
        }
        if (!self::host_allowed($url)) {
            return new WP_Error('ezr_image_failed', 'Bild-URL nicht erlaubt: nur Bilder aus dem EzyHub-Speicher.', ['status' => 422]);
        }
        $source = strtok($url, '?');
        global $wpdb;
        $existing = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_ezyrank_source_url' AND meta_value = %s LIMIT 1",
            $source
        ));
        if ($existing && get_post($existing)) {
            if ($alt !== null) update_post_meta($existing, '_wp_attachment_image_alt', sanitize_text_field($alt));
            return $existing;
        }

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $tmp = download_url($url, 30);
        if (is_wp_error($tmp)) {
            return new WP_Error('ezr_image_failed', 'Bild konnte nicht geladen werden: ' . $tmp->get_error_message(), ['status' => 422]);
        }
        $ext = strtolower(pathinfo((string) wp_parse_url($source, PHP_URL_PATH), PATHINFO_EXTENSION));
        $info = wp_check_filetype_and_ext($tmp, 'bild.' . ($ext ?: 'jpg'), self::TYPES);
        if (empty($info['type']) || !in_array($info['type'], self::TYPES, true)) {
            @unlink($tmp);
            return new WP_Error('ezr_image_failed', 'Dateityp nicht erlaubt (nur JPG, PNG, WebP, GIF).', ['status' => 422]);
        }
        $name = sanitize_file_name(basename((string) wp_parse_url($source, PHP_URL_PATH)));
        if ($name === '' || strpos($name, '.') === false) $name = 'ezyrank-bild.' . ($info['ext'] ?: 'jpg');
        $id = media_handle_sideload(['name' => $name, 'tmp_name' => $tmp], (int) $parent_id);
        if (is_wp_error($id)) {
            @unlink($tmp);
            return new WP_Error('ezr_image_failed', 'Bild konnte nicht gespeichert werden: ' . $id->get_error_message(), ['status' => 422]);
        }
        update_post_meta($id, '_ezyrank_source_url', $source);
        if ($alt !== null) update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field($alt));
        return (int) $id;
    }
}
