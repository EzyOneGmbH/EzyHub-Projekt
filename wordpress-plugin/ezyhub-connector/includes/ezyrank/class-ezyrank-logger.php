<?php
/**
 * Protokoll der letzten 100 EzyRank-Ereignisse (Kap. 7.9). Keine
 * Besucherdaten, keine Schlüssel: nur Typ, Text, Fehlercode, Beitrag.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Logger {
    const OPT = 'ezyrank_log';
    const MAX = 100;

    public static function log($type, $message, $code = '', $post_id = 0) {
        $log = get_option(self::OPT, []);
        $log = is_array($log) ? $log : [];
        array_unshift($log, [
            't'       => time(),
            'type'    => (string) $type,
            'message' => mb_substr((string) $message, 0, 300),
            'code'    => (string) $code,
            'post_id' => (int) $post_id,
        ]);
        update_option(self::OPT, array_slice($log, 0, self::MAX), false);
        if ($code !== '') update_option('ezyrank_last_error', ['t' => time(), 'code' => $code, 'message' => (string) $message], false);
    }

    public static function all() {
        $log = get_option(self::OPT, []);
        return is_array($log) ? $log : [];
    }
}
