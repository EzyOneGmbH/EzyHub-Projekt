<?php
/**
 * IndexNow (ab 2.1.0): meldet neue oder geänderte Beiträge an Bing, Yandex,
 * Seznam, Naver und weitere Suchmaschinen, die das Protokoll unterstützen.
 *
 * Der Schlüssel ist KEIN Geheimnis: Er steht öffentlich unter /{key}.txt und
 * beweist nur, dass die Meldung von dieser Website kommt. Google nimmt nicht
 * an IndexNow teil; dort läuft die Meldung über die Sitemap (EzyHub).
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Indexnow {
    const OPT = 'ezyrank_indexnow_key';
    const ENDPOINT = 'https://api.indexnow.org/indexnow';

    /** Schlüssel lesen, beim ersten Aufruf erzeugen (32 Hex-Zeichen). */
    public static function key() {
        $key = (string) get_option(self::OPT, '');
        if (!preg_match('/^[a-f0-9]{32}$/', $key)) {
            $key = bin2hex(random_bytes(16));
            update_option(self::OPT, $key, false);
        }
        return $key;
    }

    public static function key_location() {
        return home_url('/' . self::key() . '.txt');
    }

    /** Trifft der Anfragepfad die Schlüsseldatei? Pure, für Tests. */
    public static function is_key_request($uri, $key, $home_path = '') {
        $path = (string) parse_url((string) $uri, PHP_URL_PATH);
        $base = rtrim((string) $home_path, '/');
        return $key !== '' && $path === $base . '/' . $key . '.txt';
    }

    /** Hook init: Schlüsseldatei ausliefern, ohne eine echte Datei anzulegen. */
    public static function serve_key() {
        $key = (string) get_option(self::OPT, '');
        if ($key === '' || empty($_SERVER['REQUEST_URI'])) return;
        $home_path = (string) parse_url(home_url('/'), PHP_URL_PATH);
        if (!self::is_key_request($_SERVER['REQUEST_URI'], $key, $home_path)) return;
        status_header(200);
        header('Content-Type: text/plain; charset=utf-8');
        header('X-Robots-Tag: noindex');
        echo $key;
        exit;
    }

    /**
     * URL melden. Gibt immer ein Array zurück und wirft nie: Ein Fehler hier
     * darf das Veröffentlichen nicht aufhalten.
     */
    public static function ping($url) {
        $url = esc_url_raw((string) $url);
        if ($url === '') return ['ok' => false, 'status' => 0, 'error' => 'Keine URL'];
        if ((string) get_option('blog_public', '1') === '0') {
            return ['ok' => false, 'status' => 0, 'error' => 'Website ist für Suchmaschinen gesperrt (Einstellungen › Lesen)'];
        }
        if (!apply_filters('ezyrank_indexnow_enabled', true, $url)) {
            return ['ok' => false, 'status' => 0, 'error' => 'IndexNow ist auf dieser Website abgeschaltet'];
        }
        $res = wp_remote_post(self::ENDPOINT, [
            'timeout' => 8,
            'headers' => ['Content-Type' => 'application/json; charset=utf-8'],
            'body'    => wp_json_encode([
                'host'        => (string) parse_url(home_url('/'), PHP_URL_HOST),
                'key'         => self::key(),
                'keyLocation' => self::key_location(),
                'urlList'     => [$url],
            ]),
        ]);
        if (is_wp_error($res)) {
            $out = ['ok' => false, 'status' => 0, 'error' => mb_substr($res->get_error_message(), 0, 120)];
        } else {
            $status = (int) wp_remote_retrieve_response_code($res);
            // 200 = angenommen, 202 = angenommen, Schlüsselprüfung steht noch aus.
            $out = ['ok' => $status === 200 || $status === 202, 'status' => $status];
            if (!$out['ok']) $out['error'] = 'HTTP ' . $status;
        }
        $out['url'] = $url;
        EzyRank_Logger::log($out['ok'] ? 'indexnow.ok' : 'indexnow.failed', $url, $out['ok'] ? '' : 'ezr_indexnow_failed');
        return $out;
    }
}
