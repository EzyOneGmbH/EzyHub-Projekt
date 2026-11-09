<?php
/**
 * EzyRank-Schnittstelle: Verbindungsschlüssel, Scopes, HTTPS-Pflicht und
 * Rate-Limit (Bauanleitung Kap. 7.3).
 *
 * - Schlüssel: "ezr_" + 44 Hex-Zeichen (random_bytes), wird genau einmal
 *   angezeigt. Gespeichert wird nur HMAC-SHA256 mit wp_salt('auth').
 * - Header: Authorization: Bearer ezr_… oder X-EzyRank-Key (Fallback, weil
 *   manche Hoster den Authorization-Header entfernen).
 * - Es gibt KEINEN öffentlichen Endpunkt: jede Route prüft hier.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Auth {
    const OPT_HASH      = 'ezyrank_key_hash';
    const OPT_CREATED   = 'ezyrank_key_created';
    const OPT_LAST4     = 'ezyrank_key_last4';
    const OPT_PUBLISH   = 'ezyrank_scope_publish';
    const RATE_PER_MIN  = 120;
    const FAIL_LIMIT    = 10;
    const FAIL_WINDOW   = 600;   // 10 Minuten
    const BLOCK_SECONDS = 900;   // 15 Minuten

    /** Neuen Schlüssel erzeugen; der alte ist damit sofort ungültig. */
    public static function generate_key() {
        $key = 'ezr_' . bin2hex(random_bytes(22));
        update_option(self::OPT_HASH, self::hash($key), false);
        update_option(self::OPT_CREATED, time(), false);
        update_option(self::OPT_LAST4, substr($key, -4), false);
        EzyRank_Logger::log('key.generated', 'Neuer Verbindungsschlüssel erzeugt');
        return $key;
    }

    public static function has_key() {
        return (string) get_option(self::OPT_HASH, '') !== '';
    }

    public static function hash($key) {
        return hash_hmac('sha256', (string) $key, wp_salt('auth'));
    }

    /** read und draft sind immer aktiv, publish nur per Schalter im Admin. */
    public static function scopes() {
        $s = ['read', 'draft'];
        if (get_option(self::OPT_PUBLISH, '0') === '1') $s[] = 'publish';
        return $s;
    }

    public static function key_from_request($request) {
        $auth = (string) $request->get_header('authorization');
        if ($auth === '' && isset($_SERVER['HTTP_AUTHORIZATION'])) $auth = (string) $_SERVER['HTTP_AUTHORIZATION'];
        if ($auth === '' && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $auth = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        if (stripos($auth, 'Bearer ') === 0) {
            $k = trim(substr($auth, 7));
            if ($k !== '') return $k;
        }
        return trim((string) $request->get_header('x_ezyrank_key'));
    }

    public static function is_https() {
        if (is_ssl()) return true;
        if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') return true;
        return function_exists('wp_get_environment_type') && wp_get_environment_type() === 'local';
    }

    private static function ip() {
        $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        return $ip !== '' ? $ip : '0.0.0.0';
    }

    private static function err($code, $message, $status) {
        return new WP_Error($code, $message, ['status' => $status]);
    }

    /**
     * Prüft eine Anfrage für einen Scope. Rückgabe true oder WP_Error mit
     * ezr_-Code (Kap. 7.10). Reihenfolge: HTTPS, Sperre/Rate-Limit, Schlüssel,
     * Scope.
     */
    public static function check($request, $scope) {
        if (!self::is_https()) {
            return self::err('ezr_https_required', 'Die EzyRank-Schnittstelle antwortet nur über HTTPS.', 403);
        }
        $ipkey = md5(self::ip());
        if (get_transient('ezyrank_block_' . $ipkey)) {
            return self::err('ezr_rate_limited', 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.', 429);
        }
        $bucket = 'ezyrank_rl_' . $ipkey . '_' . (int) floor(time() / 60);
        $count = (int) get_transient($bucket) + 1;
        set_transient($bucket, $count, 120);
        if ($count > self::RATE_PER_MIN) {
            return self::err('ezr_rate_limited', 'Zu viele Anfragen. Bitte später erneut versuchen.', 429);
        }

        $key = self::key_from_request($request);
        if ($key === '') {
            return self::err('ezr_auth_missing', 'Kein Verbindungsschlüssel gesendet.', 401);
        }
        $stored = (string) get_option(self::OPT_HASH, '');
        if ($stored === '' || !hash_equals($stored, self::hash($key))) {
            self::record_failure($ipkey);
            return self::err('ezr_auth_invalid', 'Der Verbindungsschlüssel ist ungültig.', 401);
        }
        if (!in_array($scope, self::scopes(), true)) {
            return self::err('ezr_scope_missing', sprintf('Die Berechtigung «%s» ist im Plugin nicht aktiviert.', $scope), 403);
        }
        update_option('ezyrank_last_ok', time(), false);
        return true;
    }

    private static function record_failure($ipkey) {
        $k = 'ezyrank_fail_' . $ipkey;
        $now = time();
        $list = get_transient($k);
        $list = is_array($list) ? $list : [];
        $list = array_values(array_filter($list, function ($t) use ($now) { return $t > $now - EzyRank_Auth::FAIL_WINDOW; }));
        $list[] = $now;
        set_transient($k, $list, self::FAIL_WINDOW);
        if (count($list) >= self::FAIL_LIMIT) {
            set_transient('ezyrank_block_' . $ipkey, 1, self::BLOCK_SECONDS);
            delete_transient($k);
            EzyRank_Logger::log('auth.blocked', 'IP nach 10 Fehlversuchen für 15 Minuten gesperrt', 'ezr_rate_limited');
        } else {
            EzyRank_Logger::log('auth.failed', 'Ungültiger Schlüssel', 'ezr_auth_invalid');
        }
    }

    /** permission_callback für register_rest_route. */
    public static function permission($scope) {
        return function ($request) use ($scope) {
            return EzyRank_Auth::check($request, $scope);
        };
    }
}
