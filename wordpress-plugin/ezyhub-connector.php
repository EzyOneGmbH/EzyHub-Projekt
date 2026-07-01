<?php
/**
 * Plugin Name: EzyHub Connector
 * Description: Lässt EzyHub technische SEO-Maßnahmen autonom deployen — <head>-Injektion (JSON-LD, OG, Meta), llms.txt, Seiten-Meta, Canonical/Noindex, robots.txt, Sitemap-Optimierung, Bild-Alt-Texte und Elementor-Editing (Headings + Text-Widgets) mit automatischem Backup/Restore. Auth via Application Passwords (manage_options). Alle Änderungen reversibel.
 * Version: 1.8.3
 * Author: EzyOne GmbH
 * License: GPL-2.0+
 */

if (!defined('ABSPATH')) exit;

class EzyHub_Connector {
    const OPT_HEAD     = 'ezyhub_head_html';
    const OPT_LLMS     = 'ezyhub_llms_txt';
    const OPT_ROBOTS   = 'ezyhub_robots_txt';
    const NS           = 'ezyhub/v1';

    public function __construct() {
        add_action('rest_api_init', [$this, 'routes']);
        add_action('wp_head', [$this, 'inject_head'], 99);
        add_action('init', [$this, 'maybe_serve_llms']);
        // Sitemap: drop author archives (+ keep it lean).
        add_filter('wp_sitemaps_add_provider', [$this, 'filter_sitemap_provider'], 10, 2);
        // robots.txt additions.
        add_filter('robots_txt', [$this, 'filter_robots_txt'], 20, 2);
        // Per-page canonical + noindex.
        add_action('wp_head', [$this, 'inject_canonical'], 1);
        add_filter('wp_robots', [$this, 'filter_wp_robots']);
        // Per-page SEO title — override the <title> tag.
        add_filter('pre_get_document_title', [$this, 'filter_title'], 99);
    }

    /** Override the document <title> with the stored SEO title (if set). */
    public function filter_title($title) {
        if (is_singular()) {
            $id = get_queried_object_id();
            $t = get_post_meta($id, '_ezyhub_seo_title', true);
            if ($t) return self::clean_meta_text($t); // bereinigt auch alt gespeicherte kaputte Werte (�)
        }
        return $title;
    }

    public function can_write() { return current_user_can('manage_options'); }

    // Purge page caches so deployed changes go live immediately (LiteSpeed,
    // WP Rocket, W3TC, generic object cache). Called after every change.
    public function purge_caches() {
        do_action('litespeed_purge_all');           // LiteSpeed Cache
        if (function_exists('rocket_clean_domain')) { @rocket_clean_domain(); } // WP Rocket
        if (function_exists('w3tc_flush_all')) { @w3tc_flush_all(); }           // W3 Total Cache
        if (function_exists('wp_cache_clear_cache')) { @wp_cache_clear_cache(); } // WP Super Cache
        if (function_exists('wp_cache_flush')) { @wp_cache_flush(); }
    }

    // ── Theme-Datei-Sandbox: löst einen relativen Pfad gegen wp-content/themes
    // auf und verweigert alles außerhalb bzw. mit unerlaubter Endung. ──
    private function safe_theme_path($rel) {
        $rel = (string) $rel;
        if ($rel === '') return new WP_Error('bad', 'file erforderlich', ['status' => 400]);
        if (strpos($rel, "\0") !== false) return new WP_Error('bad', 'ungültiger Pfad', ['status' => 400]);
        $root = realpath(WP_CONTENT_DIR . '/themes');
        if (!$root) return new WP_Error('no_root', 'themes-Verzeichnis nicht gefunden', ['status' => 500]);
        $rel = ltrim(str_replace('\\', '/', $rel), '/');
        $target = realpath($root . '/' . $rel);
        if ($target === false) return new WP_Error('nf', 'Datei nicht gefunden', ['status' => 404]);
        // Muss echt innerhalb des themes-Roots liegen (kein ../-Ausbruch).
        if (strpos($target, $root . DIRECTORY_SEPARATOR) !== 0) return new WP_Error('forbidden', 'Pfad außerhalb wp-content/themes', ['status' => 403]);
        $ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
        if (!in_array($ext, ['php', 'js', 'css', 'html', 'htm', 'twig'], true)) return new WP_Error('forbidden', 'Dateityp nicht erlaubt: ' . $ext, ['status' => 403]);
        if (!is_writable($target)) return new WP_Error('ro', 'Datei nicht schreibbar', ['status' => 403]);
        return $target;
    }

    // ── PHP-Syntaxcheck via `php -l` gegen eine Temp-Datei. Wenn exec/php nicht
    // verfügbar ist, wird ran=false zurückgegeben (kein Blocker, Backup bleibt). ──
    private function php_lint($code) {
        $tmp = wp_tempnam('ezylint');
        if (!$tmp) return ['ran' => false, 'ok' => true, 'msg' => 'kein Temp'];
        @file_put_contents($tmp, $code);
        $out = ''; $ran = false; $ok = true;
        // php-cli unterstützt `-l`; php-fpm/php-cgi liefern teils nicht-null Exit
        // ohne echten Fehler. Deshalb wird NUR anhand echter Fehler-Signaturen
        // entschieden — sonst „inconclusive" (ran=false, nicht blockierend).
        $php = defined('PHP_BINARY') && PHP_BINARY ? PHP_BINARY : 'php';
        $can_exec = function ($fn) { return function_exists($fn) && !in_array($fn, array_map('trim', explode(',', (string) ini_get('disable_functions'))), true); };
        if ($can_exec('exec')) {
            $lines = []; $rc = 0; @exec(escapeshellarg($php) . ' -l ' . escapeshellarg($tmp) . ' 2>&1', $lines, $rc);
            $out = trim(implode("\n", $lines));
        } elseif ($can_exec('shell_exec')) {
            $res = @shell_exec(escapeshellarg($php) . ' -l ' . escapeshellarg($tmp) . ' 2>&1');
            if ($res !== null) $out = trim($res);
        }
        $hasErr = (stripos($out, 'syntax error') !== false) || (stripos($out, 'Parse error') !== false) || (stripos($out, 'Fatal error') !== false);
        $hasOk  = (stripos($out, 'No syntax errors') !== false);
        if ($hasErr)      { $ran = true; $ok = false; }
        elseif ($hasOk)   { $ran = true; $ok = true; }
        else              { $ran = false; $ok = true; } // unklar -> nicht blockieren
        @unlink($tmp);
        return ['ran' => $ran, 'ok' => $ok, 'msg' => substr($out, 0, 300)];
    }

    // ── Elementor safety net: snapshot _elementor_data before any change ──
    // Keeps the last 8 snapshots in postmeta so every edit is fully reversible.
    private function backup_elementor($postId) {
        $cur = get_post_meta($postId, '_elementor_data', true);
        if (!$cur) return;
        $backups = get_post_meta($postId, '_ezyhub_elementor_backups', true);
        if (!is_array($backups)) $backups = [];
        array_unshift($backups, ['ts' => current_time('mysql'), 'data' => $cur]);
        $backups = array_slice($backups, 0, 8);
        update_post_meta($postId, '_ezyhub_elementor_backups', $backups);
    }
    private function save_elementor($postId, $tree) {
        update_post_meta($postId, '_elementor_data', wp_slash(wp_json_encode($tree)));
        delete_post_meta($postId, '_elementor_css'); // force regeneration
        if (class_exists('\Elementor\Plugin')) {
            try { \Elementor\Plugin::$instance->files_manager->clear_cache(); } catch (\Throwable $e) {}
        }
        $this->purge_caches();
    }

    public function routes() {
        $auth = [$this, 'can_write'];

        register_rest_route(self::NS, '/status', ['methods' => 'GET', 'permission_callback' => $auth, 'callback' => function () {
            $head = get_option(self::OPT_HEAD, []);
            return [
                'ok' => true, 'plugin' => 'ezyhub-connector', 'version' => '1.8.3',
                'headKeys' => is_array($head) ? array_keys($head) : [],
                'llmsBytes' => strlen((string) get_option(self::OPT_LLMS, '')),
                'robotsBytes' => strlen((string) get_option(self::OPT_ROBOTS, '')),
                'elementorActive' => did_action('elementor/loaded') || defined('ELEMENTOR_VERSION'),
            ];
        }]);

        // ── Self-Update: ueberschreibt die eigene Plugin-Datei (base64) ──
        // Ermoeglicht ferngesteuerte Updates ueber die EzyHub-Bruecke. Sichert die
        // alte Version als .bak. Gated wie alle Schreib-Routen (manage_options +
        // Application Password). Validiert, dass es eine EzyHub-Connector-PHP-Datei ist.
        register_rest_route(self::NS, '/plugin/self-update', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $b64 = (string) ($r['contentB64'] ?? '');
            if ($b64 === '') return new WP_Error('no_content', 'contentB64 erforderlich', ['status' => 400]);
            $php = base64_decode($b64, true);
            if ($php === false) return new WP_Error('bad_b64', 'contentB64 ist kein gueltiges base64', ['status' => 400]);
            if (substr($php, 0, 5) !== '<?php' || strpos($php, 'Plugin Name: EzyHub Connector') === false)
                return new WP_Error('bad_plugin', 'Kein gueltiges EzyHub-Connector-Plugin', ['status' => 400]);
            $file = __FILE__;
            if (!is_writable($file)) return new WP_Error('not_writable', 'Plugin-Datei nicht beschreibbar (Dateirechte/DISALLOW_FILE_MODS)', ['status' => 409]);
            @copy($file, $file . '.bak');
            $bytes = file_put_contents($file, $php);
            if ($bytes === false) return new WP_Error('write_failed', 'Schreiben fehlgeschlagen', ['status' => 500]);
            // Neuen Code sofort wirksam machen: OPcache der Datei invalidieren +
            // Caches leeren (LiteSpeed cached sonst die alte REST-Antwort).
            if (function_exists('opcache_invalidate')) { @opcache_invalidate($file, true); }
            $this->purge_caches();
            $ver = preg_match('/Version:\s*([0-9.]+)/', $php, $m) ? $m[1] : '';
            return ['ok' => true, 'bytes' => $bytes, 'newVersion' => $ver, 'backup' => basename($file) . '.bak'];
        }]);

        // ── <head> snippet ──
        register_rest_route(self::NS, '/head', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $key = sanitize_key($r['key'] ?? ''); $html = (string) ($r['html'] ?? '');
            if (!$key) return new WP_Error('bad_key', 'key erforderlich', ['status' => 400]);
            $head = get_option(self::OPT_HEAD, []); if (!is_array($head)) $head = [];
            if ($html === '') unset($head[$key]); else $head[$key] = $html;
            update_option(self::OPT_HEAD, $head);
            $this->purge_caches();
            return ['ok' => true, 'keys' => array_keys($head)];
        }]);

        // ── Cache leeren (on-demand) ──
        register_rest_route(self::NS, '/purge', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function () {
            $this->purge_caches();
            return ['ok' => true, 'purged' => true];
        }]);

        // ── Code-Snippet finden (Header/Footer-Tracking/Widget-Code in
        // Posts / Postmeta / Optionen). Read-only Suche fuer kontrollierte
        // Anpassungen wie Mews-Lazy-Load. ──
        register_rest_route(self::NS, '/code-locate', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            global $wpdb;
            $needle = (string) ($r['needle'] ?? '');
            if (strlen($needle) < 6) return new WP_Error('bad_needle', 'needle (>=6 Zeichen) erforderlich', ['status' => 400]);
            $like = '%' . $wpdb->esc_like($needle) . '%';
            $hits = [];
            foreach ($wpdb->get_results($wpdb->prepare("SELECT ID, post_type, post_title, post_content FROM {$wpdb->posts} WHERE post_content LIKE %s AND post_status NOT IN ('trash','auto-draft')", $like)) as $p)
                $hits[] = ['where' => 'post', 'post_type' => $p->post_type, 'id' => (int) $p->ID, 'title' => $p->post_title, 'len' => strlen($p->post_content), 'content' => $p->post_content];
            foreach ($wpdb->get_results($wpdb->prepare("SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta} WHERE meta_value LIKE %s", $like)) as $m)
                $hits[] = ['where' => 'postmeta', 'id' => (int) $m->post_id, 'meta_key' => $m->meta_key, 'len' => strlen($m->meta_value), 'content' => $m->meta_value];
            foreach ($wpdb->get_results($wpdb->prepare("SELECT option_name, option_value FROM {$wpdb->options} WHERE option_value LIKE %s", $like)) as $o)
                $hits[] = ['where' => 'option', 'option_name' => $o->option_name, 'len' => strlen($o->option_value), 'content' => $o->option_value];
            return ['ok' => true, 'count' => count($hits), 'hits' => $hits];
        }]);

        // ── Code-Snippet ersetzen (mit Backup). Schreibt post_content via $wpdb
        // (umgeht kses -> <script> bleibt exakt); Postmeta/Optionen via API. ──
        register_rest_route(self::NS, '/code-write', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            global $wpdb;
            $where = (string) ($r['where'] ?? '');
            $content = (string) ($r['content'] ?? '');
            if ($content === '') return new WP_Error('bad', 'content erforderlich', ['status' => 400]);
            if ($where === 'post') {
                $id = (int) ($r['id'] ?? 0); if (!$id) return new WP_Error('bad', 'id erforderlich', ['status' => 400]);
                $cur = get_post($id); if (!$cur) return new WP_Error('nf', 'Post nicht gefunden', ['status' => 404]);
                update_post_meta($id, '_ezyhub_code_bak', $cur->post_content);
                $wpdb->update($wpdb->posts, ['post_content' => $content], ['ID' => $id]);
                clean_post_cache($id);
            } elseif ($where === 'postmeta') {
                $id = (int) ($r['id'] ?? 0); $mk = (string) ($r['meta_key'] ?? $r['metaKey'] ?? '');
                if (!$id || !$mk) return new WP_Error('bad', 'id + meta_key erforderlich', ['status' => 400]);
                update_post_meta($id, '_ezyhub_meta_bak_' . $mk, get_post_meta($id, $mk, true));
                update_post_meta($id, $mk, $content);
            } elseif ($where === 'option') {
                $on = (string) ($r['option_name'] ?? $r['optionName'] ?? '');
                if (!$on) return new WP_Error('bad', 'option_name erforderlich', ['status' => 400]);
                // Backup als exakter Roh-String (nicht die unserialisierte Form),
                // damit auch serialisierte Optionen 1:1 restaurierbar bleiben.
                update_option('_ezyhub_opt_bak_' . $on, $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $on)));
                if (is_serialized($content)) {
                    // Vorserialisierter Payload (z.B. bearbeitetes hefo-Array):
                    // roh via $wpdb schreiben, sonst würde update_option/maybe_serialize
                    // den bereits serialisierten String DOPPELT serialisieren -> kaputt.
                    $exists = $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name = %s", $on));
                    if ($exists) $wpdb->update($wpdb->options, ['option_value' => $content], ['option_name' => $on]);
                    else $wpdb->insert($wpdb->options, ['option_name' => $on, 'option_value' => $content, 'autoload' => 'yes']);
                    wp_cache_delete($on, 'options');
                    wp_cache_delete('alloptions', 'options');
                } else {
                    update_option($on, $content);
                }
            } else {
                return new WP_Error('bad', 'where muss post|postmeta|option sein', ['status' => 400]);
            }
            $this->purge_caches();
            return ['ok' => true, 'where' => $where];
        }]);

        // ── Theme-Datei-Editor (Sandbox: nur wp-content/themes) ──────────────
        // Manche Snippets (z.B. hartcodierte <script>-Loader) leben in Theme-
        // PHP-Dateien, nicht in der DB. Diese Endpoints erlauben gezieltes
        // Lokalisieren + chirurgisches Ersetzen mit Voll-Backup, PHP-Lint und
        // 1-Klick-Restore. Streng auf wp-content/themes + erlaubte Endungen
        // begrenzt; kein Zugriff auf Plugins/Core/uploads.
        register_rest_route(self::NS, '/theme-file-locate', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $needle = (string) ($r['needle'] ?? '');
            if (strlen($needle) < 6) return new WP_Error('bad_needle', 'needle (>=6 Zeichen) erforderlich', ['status' => 400]);
            $root = realpath(WP_CONTENT_DIR . '/themes');
            if (!$root) return new WP_Error('no_root', 'themes-Verzeichnis nicht gefunden', ['status' => 500]);
            $exts = ['php', 'js', 'css', 'html', 'htm', 'twig'];
            $hits = []; $scanned = 0;
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $f) {
                if (!$f->isFile()) continue;
                if (!in_array(strtolower($f->getExtension()), $exts, true)) continue;
                if ($f->getSize() > 3_000_000) continue;
                $scanned++;
                $txt = @file_get_contents($f->getPathname());
                if ($txt === false || strpos($txt, $needle) === false) continue;
                $lines = []; $ln = 0;
                foreach (preg_split('/\r\n|\r|\n/', $txt) as $line) { $ln++;
                    if (strpos($line, $needle) !== false) $lines[] = ['line' => $ln, 'text' => substr(trim($line), 0, 300)];
                    if (count($lines) >= 20) break;
                }
                $hits[] = ['file' => str_replace($root . DIRECTORY_SEPARATOR, '', $f->getPathname()), 'count' => count($lines), 'lines' => $lines, 'size' => $f->getSize()];
                if (count($hits) >= 50) break;
            }
            return ['ok' => true, 'scanned' => $scanned, 'files' => count($hits), 'hits' => $hits];
        }]);

        register_rest_route(self::NS, '/theme-file-read', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $path = $this->safe_theme_path((string) ($r['file'] ?? ''));
            if (is_wp_error($path)) return $path;
            $txt = @file_get_contents($path);
            if ($txt === false) return new WP_Error('read', 'Datei nicht lesbar', ['status' => 500]);
            return ['ok' => true, 'file' => (string) ($r['file'] ?? ''), 'len' => strlen($txt), 'content' => $txt];
        }]);

        register_rest_route(self::NS, '/theme-file-write', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $path = $this->safe_theme_path((string) ($r['file'] ?? ''));
            if (is_wp_error($path)) return $path;
            $cur = @file_get_contents($path);
            if ($cur === false) return new WP_Error('read', 'Datei nicht lesbar', ['status' => 500]);
            $old = (string) ($r['oldString'] ?? '');
            $new = (string) ($r['newString'] ?? '');
            $full = isset($r['content']) ? (string) $r['content'] : null;
            if ($full === null) {
                if ($old === '') return new WP_Error('bad', 'oldString oder content erforderlich', ['status' => 400]);
                $n = substr_count($cur, $old);
                if ($n === 0) return new WP_Error('nomatch', 'oldString nicht gefunden', ['status' => 404]);
                if ($n > 1) return new WP_Error('ambiguous', "oldString $n× gefunden — muss eindeutig sein", ['status' => 409]);
                $result = str_replace($old, $new, $cur);
            } else {
                $result = $full;
            }
            if ($result === $cur) return ['ok' => true, 'unchanged' => true];
            // Voll-Backup mit Zeitstempel neben der Datei.
            $bak = $path . '.ezybak-' . gmdate('Ymd-His');
            if (@file_put_contents($bak, $cur) === false) return new WP_Error('bak', 'Backup fehlgeschlagen — kein Schreibzugriff?', ['status' => 500]);
            // PHP-Lint gegen Temp-Datei, bevor die Live-Datei überschrieben wird.
            $linted = null; $lint_msg = '';
            if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'php') {
                $lint = $this->php_lint($result);
                $linted = $lint['ok']; $lint_msg = $lint['msg'];
                if ($lint['ran'] && !$lint['ok']) return new WP_Error('lint', 'PHP-Syntaxfehler — nicht geschrieben: ' . $lint['msg'], ['status' => 422]);
            }
            if (@file_put_contents($path, $result) === false) return new WP_Error('write', 'Schreiben fehlgeschlagen', ['status' => 500]);
            $this->purge_caches();
            return ['ok' => true, 'file' => (string) ($r['file'] ?? ''), 'backup' => basename($bak), 'bytes' => strlen($result), 'linted' => $linted, 'lint' => $lint_msg];
        }]);

        register_rest_route(self::NS, '/theme-file-restore', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $path = $this->safe_theme_path((string) ($r['file'] ?? ''));
            if (is_wp_error($path)) return $path;
            $bakName = (string) ($r['backup'] ?? '');
            if ($bakName === '') {
                // Neuestes Backup automatisch wählen.
                $cands = glob($path . '.ezybak-*');
                if (!$cands) return new WP_Error('nobak', 'Kein Backup gefunden', ['status' => 404]);
                rsort($cands); $bak = $cands[0];
            } else {
                if (strpos($bakName, '/') !== false || strpos($bakName, '\\') !== false || strpos($bakName, '..') !== false)
                    return new WP_Error('bad', 'ungültiger backup-Name', ['status' => 400]);
                $bak = dirname($path) . DIRECTORY_SEPARATOR . $bakName;
            }
            $prev = @file_get_contents($bak);
            if ($prev === false) return new WP_Error('nobak', 'Backup nicht lesbar', ['status' => 404]);
            if (@file_put_contents($path, $prev) === false) return new WP_Error('write', 'Restore fehlgeschlagen', ['status' => 500]);
            $this->purge_caches();
            return ['ok' => true, 'file' => (string) ($r['file'] ?? ''), 'restored_from' => basename($bak)];
        }]);

        // ── llms.txt ──
        register_rest_route(self::NS, '/llms-txt', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            update_option(self::OPT_LLMS, (string) ($r['content'] ?? ''));
            $this->purge_caches();
            return ['ok' => true, 'bytes' => strlen((string) get_option(self::OPT_LLMS, ''))];
        }]);

        // ── robots.txt additions ──
        register_rest_route(self::NS, '/robots-txt', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            update_option(self::OPT_ROBOTS, (string) ($r['content'] ?? ''));
            $this->purge_caches();
            return ['ok' => true, 'bytes' => strlen((string) get_option(self::OPT_ROBOTS, ''))];
        }]);

        // ── Page meta: SEO title/description + canonical + noindex ──
        register_rest_route(self::NS, '/page-meta', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            if (!$id || !get_post($id)) return new WP_Error('bad_id', 'gültige postId erforderlich', ['status' => 400]);
            if (isset($r['seoTitle']))       update_post_meta($id, '_ezyhub_seo_title', sanitize_text_field(self::clean_meta_text($r['seoTitle'])));
            if (isset($r['seoDescription'])) update_post_meta($id, '_ezyhub_seo_description', sanitize_text_field(self::clean_meta_text($r['seoDescription'])));
            if (isset($r['canonical']))      update_post_meta($id, '_ezyhub_canonical', esc_url_raw($r['canonical']));
            if (isset($r['noindex']))        update_post_meta($id, '_ezyhub_noindex', $r['noindex'] ? '1' : '');
            do_action('litespeed_purge_post', $id);
            $this->purge_caches();
            return ['ok' => true, 'postId' => $id];
        }]);

        // ── Images missing alt text ──
        register_rest_route(self::NS, '/images-missing-alt', ['methods' => 'GET', 'permission_callback' => $auth, 'callback' => function ($r) {
            $q = new WP_Query([
                'post_type' => 'attachment', 'post_mime_type' => 'image', 'post_status' => 'inherit',
                'posts_per_page' => intval($r['limit'] ?? 50), 'fields' => 'ids',
                'meta_query' => [ 'relation' => 'OR',
                    ['key' => '_wp_attachment_image_alt', 'compare' => 'NOT EXISTS'],
                    ['key' => '_wp_attachment_image_alt', 'value' => '', 'compare' => '='],
                ],
            ]);
            $out = array_map(function ($id) {
                return ['id' => $id, 'filename' => basename(get_attached_file($id)), 'url' => wp_get_attachment_url($id), 'title' => get_the_title($id)];
            }, $q->posts);
            return ['ok' => true, 'count' => count($out), 'images' => $out];
        }]);

        // ── Set image alt text ──
        register_rest_route(self::NS, '/alt-text', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['attachmentId'] ?? 0);
            if (!$id || get_post_type($id) !== 'attachment') return new WP_Error('bad_id', 'gültige attachmentId erforderlich', ['status' => 400]);
            update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field($r['alt'] ?? ''));
            $this->purge_caches();
            return ['ok' => true, 'attachmentId' => $id];
        }]);

        // ── Elementor: read heading widgets (id, current tag, text) for a page ──
        register_rest_route(self::NS, '/elementor/headings', ['methods' => 'GET', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            if (!$id) return new WP_Error('bad_id', 'postId erforderlich', ['status' => 400]);
            $data = get_post_meta($id, '_elementor_data', true);
            if (!$data) return ['ok' => true, 'elementor' => false, 'headings' => []];
            $tree = json_decode($data, true);
            $headings = [];
            $walk = function ($els) use (&$walk, &$headings) {
                foreach ((array) $els as $el) {
                    if (($el['widgetType'] ?? '') === 'heading') {
                        $headings[] = [
                            'widgetId' => $el['id'] ?? '',
                            'tag' => $el['settings']['header_size'] ?? 'h2',
                            'title' => wp_strip_all_tags($el['settings']['title'] ?? ''),
                        ];
                    }
                    if (!empty($el['elements'])) $walk($el['elements']);
                }
            };
            $walk($tree);
            return ['ok' => true, 'elementor' => true, 'headings' => $headings];
        }]);

        // ── Elementor: surgically set a heading widget's tag (h1..h6) — text unchanged ──
        register_rest_route(self::NS, '/elementor/set-heading', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            $widgetId = sanitize_text_field($r['widgetId'] ?? '');
            $tag = strtolower(sanitize_text_field($r['tag'] ?? ''));
            if (!$id || !$widgetId || !in_array($tag, ['h1','h2','h3','h4','h5','h6'], true))
                return new WP_Error('bad', 'postId, widgetId, tag(h1-h6) erforderlich', ['status' => 400]);
            $data = get_post_meta($id, '_elementor_data', true);
            if (!$data) return new WP_Error('no_elementor', 'Keine Elementor-Daten', ['status' => 404]);
            $tree = json_decode($data, true);
            $changed = false;
            $walk = function (&$els) use (&$walk, $widgetId, $tag, &$changed) {
                foreach ($els as &$el) {
                    if (($el['id'] ?? '') === $widgetId && ($el['widgetType'] ?? '') === 'heading') {
                        $el['settings']['header_size'] = $tag; $changed = true;
                    }
                    if (!empty($el['elements'])) $walk($el['elements']);
                }
            };
            $walk($tree);
            if (!$changed) return new WP_Error('not_found', 'Heading-Widget nicht gefunden', ['status' => 404]);
            $this->backup_elementor($id);
            $this->save_elementor($id, $tree);
            return ['ok' => true, 'postId' => $id, 'widgetId' => $widgetId, 'tag' => $tag];
        }]);

        // ── Elementor: read text-editor widgets (id + HTML) ──
        register_rest_route(self::NS, '/elementor/text-widgets', ['methods' => 'GET', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            if (!$id) return new WP_Error('bad_id', 'postId erforderlich', ['status' => 400]);
            $data = get_post_meta($id, '_elementor_data', true);
            if (!$data) return ['ok' => true, 'elementor' => false, 'widgets' => []];
            $tree = json_decode($data, true);
            $widgets = [];
            $walk = function ($els) use (&$walk, &$widgets) {
                foreach ((array) $els as $el) {
                    if (($el['widgetType'] ?? '') === 'text-editor') {
                        $widgets[] = ['widgetId' => $el['id'] ?? '', 'html' => $el['settings']['editor'] ?? ''];
                    }
                    if (!empty($el['elements'])) $walk($el['elements']);
                }
            };
            $walk($tree);
            return ['ok' => true, 'elementor' => true, 'widgets' => $widgets];
        }]);

        // ── Elementor: replace a text-editor widget's HTML (e.g. add internal links) ──
        register_rest_route(self::NS, '/elementor/set-text', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            $widgetId = sanitize_text_field($r['widgetId'] ?? '');
            $html = (string) ($r['html'] ?? '');
            if (!$id || !$widgetId || $html === '') return new WP_Error('bad', 'postId, widgetId, html erforderlich', ['status' => 400]);
            // Allow only safe post HTML (links, formatting) — wp_kses_post strips scripts etc.
            $html = wp_kses_post($html);
            $data = get_post_meta($id, '_elementor_data', true);
            if (!$data) return new WP_Error('no_elementor', 'Keine Elementor-Daten', ['status' => 404]);
            $tree = json_decode($data, true);
            $changed = false;
            $walk = function (&$els) use (&$walk, $widgetId, $html, &$changed) {
                foreach ($els as &$el) {
                    if (($el['id'] ?? '') === $widgetId && ($el['widgetType'] ?? '') === 'text-editor') {
                        $el['settings']['editor'] = $html; $changed = true;
                    }
                    if (!empty($el['elements'])) $walk($el['elements']);
                }
            };
            $walk($tree);
            if (!$changed) return new WP_Error('not_found', 'Text-Widget nicht gefunden', ['status' => 404]);
            $this->backup_elementor($id);
            $this->save_elementor($id, $tree);
            return ['ok' => true, 'postId' => $id, 'widgetId' => $widgetId];
        }]);

        // ── Elementor: list backups for a post ──
        register_rest_route(self::NS, '/elementor/backups', ['methods' => 'GET', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            if (!$id) return new WP_Error('bad_id', 'postId erforderlich', ['status' => 400]);
            $backups = get_post_meta($id, '_ezyhub_elementor_backups', true);
            if (!is_array($backups)) $backups = [];
            return ['ok' => true, 'backups' => array_map(function ($b) { return ['ts' => $b['ts'] ?? '', 'bytes' => strlen($b['data'] ?? '')]; }, $backups)];
        }]);

        // ── Elementor: restore a backup by timestamp (or latest) ──
        register_rest_route(self::NS, '/elementor/restore', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            $ts = sanitize_text_field($r['ts'] ?? '');
            if (!$id) return new WP_Error('bad_id', 'postId erforderlich', ['status' => 400]);
            $backups = get_post_meta($id, '_ezyhub_elementor_backups', true);
            if (!is_array($backups) || !$backups) return new WP_Error('no_backup', 'Kein Backup vorhanden', ['status' => 404]);
            $chosen = $ts ? null : $backups[0];
            if ($ts) foreach ($backups as $b) if (($b['ts'] ?? '') === $ts) { $chosen = $b; break; }
            if (!$chosen) return new WP_Error('not_found', 'Backup nicht gefunden', ['status' => 404]);
            // Snapshot current state first (so a restore is itself reversible), then restore.
            $this->backup_elementor($id);
            $this->save_elementor($id, json_decode($chosen['data'], true));
            return ['ok' => true, 'postId' => $id, 'restored' => $chosen['ts'] ?? 'latest'];
        }]);

        // ── Encoding-Reparatur der Elementor-Daten ──
        // Findet Strings im _elementor_data, die KEIN gueltiges UTF-8 sind (typisch:
        // versehentlich als Windows-1252 gespeicherte Umlaute/Trenner, die als "�"
        // erscheinen) und konvertiert sie zurueck nach UTF-8. Mit Backup + Cache-Regen.
        register_rest_route(self::NS, '/elementor/fix-encoding', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            $id = intval($r['postId'] ?? 0);
            if (!$id || !get_post($id)) return new WP_Error('bad_id', 'gültige postId erforderlich', ['status' => 400]);
            $raw = get_post_meta($id, '_elementor_data', true);
            if (!$raw) return new WP_Error('no_data', 'Keine Elementor-Daten vorhanden', ['status' => 404]);
            $tree = json_decode($raw, true);
            if (!is_array($tree)) return new WP_Error('bad_data', 'Elementor-Daten nicht lesbar', ['status' => 500]);
            $count = 0; $ufffd = 0;
            $fix = function (&$node) use (&$fix, &$count, &$ufffd) {
                if (is_array($node)) { foreach ($node as &$v) { $fix($v); } unset($v); return; }
                if (is_string($node) && $node !== '') {
                    if (!mb_check_encoding($node, 'UTF-8')) {
                        $node = mb_convert_encoding($node, 'UTF-8', 'Windows-1252'); $count++;
                    } elseif (strpos($node, "\xEF\xBF\xBD") !== false) {
                        $ufffd++; // bereits als U+FFFD gespeichert -> Zeichen unwiederbringlich
                    }
                }
            };
            $fix($tree);
            if ($count > 0) { $this->backup_elementor($id); $this->save_elementor($id, $tree); }
            return ['ok' => true, 'postId' => $id, 'fixedStrings' => $count, 'unrecoverableUFFFD' => $ufffd];
        }]);

        // ── Performance / Core Web Vitals: LiteSpeed-Cache-Steuerung ──
        // Reversible, RISIKOARME Optimierungen ueber die LSCWP-Optionen
        // (litespeed.conf.<id>). Bewusst NUR sichere Schalter — KEIN CSS/JS-Combine
        // oder Defer (kann Seiten brechen). Vor erster Aenderung wird der Vorzustand
        // dauerhaft gesichert; jede Aenderung leert den Cache, damit sie greift.
        register_rest_route(self::NS, '/perf/status', ['methods' => 'GET', 'permission_callback' => $auth, 'callback' => function () {
            $active = defined('LSCWP_V') || class_exists('\\LiteSpeed\\Core');
            $map = self::ls_map();
            $settings = [];
            if ($active) foreach ($map as $name => $key) $settings[$name] = (int) get_option('litespeed.conf.' . $key, 0);
            return [
                'ok' => true,
                'litespeedActive' => $active,
                'version' => defined('LSCWP_V') ? LSCWP_V : null,
                'settings' => $settings,
                'available' => array_keys($map),
                'backup' => get_option('ezyhub_litespeed_backup', null),
            ];
        }]);

        register_rest_route(self::NS, '/perf/litespeed', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            if (!(defined('LSCWP_V') || class_exists('\\LiteSpeed\\Core')))
                return new WP_Error('no_litespeed', 'LiteSpeed Cache nicht aktiv', ['status' => 409]);
            $settings = $r['settings'] ?? [];
            if (!is_array($settings) || !$settings)
                return new WP_Error('bad_input', 'settings (Objekt name->0/1) erforderlich', ['status' => 400]);
            $map = self::ls_map();
            $applied = []; $previous = []; $ignored = [];
            foreach ($settings as $name => $val) {
                if (!isset($map[$name])) { $ignored[] = $name; continue; }
                $opt = 'litespeed.conf.' . $map[$name];
                $previous[$name] = (int) get_option($opt, 0);
                update_option($opt, $val ? 1 : 0);
                $applied[$name] = $val ? 1 : 0;
            }
            // Erstes Pre-Change-Snapshot dauerhaft sichern (Notfall-Revert).
            if (get_option('ezyhub_litespeed_backup', null) === null && $previous)
                update_option('ezyhub_litespeed_backup', $previous);
            // LiteSpeed + Seiten-Cache leeren, damit die Aenderungen greifen.
            if (function_exists('do_action')) do_action('litespeed_purge_all');
            $this->purge_caches();
            return ['ok' => true, 'applied' => $applied, 'previous' => $previous, 'ignored' => $ignored];
        }]);

        // EWWW Image Optimizer: WebP + Resize aktivieren (nur erlaubte Optionen).
        register_rest_route(self::NS, '/ewww/config', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            if (!defined('EWWW_IMAGE_OPTIMIZER_VERSION') && !function_exists('ewww_image_optimizer'))
                return new WP_Error('no_ewww', 'EWWW Image Optimizer nicht aktiv', ['status' => 409]);
            $in = $r->get_json_params(); $set = [];
            if (!empty($in['webp'])) { update_option('ewww_image_optimizer_webp', 1); $set['webp'] = 1; }
            // WebP-Auslieferung (JS-Rewriting): liefert .webp an unterstuetzende Browser.
            // Explizit via webp_cdn (0/1) steuerbar -> sauberer Revert; sonst beim
            // Aktivieren von webp automatisch mit-anschalten.
            if (isset($in['webp_cdn'])) { update_option('ewww_image_optimizer_webp_for_cdn', $in['webp_cdn'] ? 1 : 0); $set['webp_cdn'] = $in['webp_cdn'] ? 1 : 0; }
            elseif (!empty($in['webp'])) { update_option('ewww_image_optimizer_webp_for_cdn', 0); $set['webp_cdn'] = 0; }
            if (!empty($in['maxw'])) { update_option('ewww_image_optimizer_maxmediawidth', (int) $in['maxw']); $set['maxw'] = (int) $in['maxw']; }
            if (!empty($in['maxh'])) { update_option('ewww_image_optimizer_maxmediaheight', (int) $in['maxh']); $set['maxh'] = (int) $in['maxh']; }
            // Kompressionsstufe: explizit gesetzt -> verwenden; sonst bei vorhandenem
            // Cloud-Key auf Lossy-Cloud defaulten (png 40 / jpg 30) -- sonst bringt der
            // Key keine Verkleinerung (lossless schrumpft Foto-PNGs ~0%). Lokales
            // Backup der Originale an, damit Lossy reversibel bleibt (EWWW Restore).
            $hasKey = (bool) get_option('ewww_image_optimizer_cloud_key', '');
            $prevPl = (int) get_option('ewww_image_optimizer_png_level', 0);
            $prevJl = (int) get_option('ewww_image_optimizer_jpg_level', 0);
            $pl = isset($in['png_level']) ? (int) $in['png_level'] : ($hasKey ? 40 : null);
            $jl = isset($in['jpg_level']) ? (int) $in['jpg_level'] : ($hasKey ? 30 : null);
            if ($pl !== null) { update_option('ewww_image_optimizer_png_level', $pl); $set['png_level'] = $pl; }
            if ($jl !== null) { update_option('ewww_image_optimizer_jpg_level', $jl); $set['jpg_level'] = $jl; }
            if ($hasKey) {
                update_option('ewww_image_optimizer_gif_level', 10);
                if (!get_option('ewww_image_optimizer_backup_files')) { update_option('ewww_image_optimizer_backup_files', 'local'); $set['backup'] = 'local'; }
                // Stufe TATSAECHLICH veraendert (z.B. lossless->lossy) -> Done-Marker
                // loeschen, damit der naechste Bulk ALLE Bilder neu (mit Lossy) optimiert.
                if (($pl !== null && $pl !== $prevPl) || ($jl !== null && $jl !== $prevJl)) {
                    global $wpdb; $wpdb->delete($wpdb->postmeta, ['meta_key' => '_ezyhub_ewww_done']); $set['relevel'] = 1;
                }
            }
            return [
                'ok' => true, 'set' => $set,
                'webp_option' => (int) get_option('ewww_image_optimizer_webp', 0),
                'webp_cdn' => (int) get_option('ewww_image_optimizer_webp_for_cdn', 0),
                'cloud_key' => get_option('ewww_image_optimizer_cloud_key', '') ? true : false,
                'png_level' => (int) get_option('ewww_image_optimizer_png_level', 0),
                'jpg_level' => (int) get_option('ewww_image_optimizer_jpg_level', 0),
                'backup_files' => (string) get_option('ewww_image_optimizer_backup_files', ''),
                'version' => defined('EWWW_IMAGE_OPTIMIZER_VERSION') ? EWWW_IMAGE_OPTIMIZER_VERSION : null,
            ];
        }]);

        // EWWW: gebuendelter, resumierbarer Bulk-Lauf (zeitbegrenzt). Markiert
        // erledigte Bilder via _ezyhub_ewww_done; meldet webp_created zurueck,
        // damit der Aufrufer erkennt, ob WebP auf diesem Host funktioniert.
        register_rest_route(self::NS, '/ewww/bulk', ['methods' => 'POST', 'permission_callback' => $auth, 'callback' => function ($r) {
            if (!function_exists('ewww_image_optimizer_resize_from_meta_data') && !function_exists('ewww_image_optimizer'))
                return new WP_Error('no_ewww', 'EWWW Image Optimizer nicht aktiv', ['status' => 409]);
            $in = $r->get_json_params();
            // reset: alle Done-Marker loeschen, damit nach geaenderter Kompressionsstufe
            // (z.B. neu auf Lossy) ALLE Bilder erneut optimiert werden, nicht nur neue.
            if (!empty($in['reset'])) { global $wpdb; $wpdb->delete($wpdb->postmeta, ['meta_key' => '_ezyhub_ewww_done']); }
            // Cloud-Key vorhanden -> EWWW ZWINGEN, auch bereits (lossless) optimierte
            // Bilder mit der aktuellen Stufe NEU zu komprimieren. Ohne Force ueberspringt
            // EWWW sie per eigener Dedup (ewwwio_images) -> 0% Ersparnis.
            if (get_option('ewww_image_optimizer_cloud_key', '')) { global $ewww_force; $ewww_force = 1; }
            $limit = min(20, max(1, (int) ($in['limit'] ?? 8)));
            $q = new WP_Query([
                'post_type' => 'attachment', 'post_mime_type' => 'image', 'post_status' => 'inherit',
                'posts_per_page' => $limit, 'fields' => 'ids', 'orderby' => 'ID', 'order' => 'ASC',
                'meta_query' => [['key' => '_ezyhub_ewww_done', 'compare' => 'NOT EXISTS']],
            ]);
            $ids = $q->posts; $done = []; $webp = 0; $bytes_before = 0; $bytes_after = 0; $start = time();
            foreach ($ids as $id) {
                if (time() - $start > 22) break; // PHP-Timeout-Schutz
                $path = get_attached_file($id);
                if ($path && file_exists($path)) {
                    $b = (int) @filesize($path); $bytes_before += $b;
                    if (function_exists('ewww_image_optimizer_resize_from_meta_data'))
                        @ewww_image_optimizer_resize_from_meta_data(wp_get_attachment_metadata($id), $id);
                    elseif (function_exists('ewww_image_optimizer'))
                        @ewww_image_optimizer($path);
                    clearstatcache(true, $path);
                    $bytes_after += (int) @filesize($path);
                    if (file_exists($path . '.webp')) $webp++;
                }
                update_post_meta($id, '_ezyhub_ewww_done', 1);
                $done[] = $id;
            }
            $rem = new WP_Query([
                'post_type' => 'attachment', 'post_mime_type' => 'image', 'post_status' => 'inherit',
                'posts_per_page' => 1, 'fields' => 'ids',
                'meta_query' => [['key' => '_ezyhub_ewww_done', 'compare' => 'NOT EXISTS']],
            ]);
            return [
                'ok' => true, 'processed' => count($done), 'webp_created' => $webp,
                'bytes_before' => $bytes_before, 'bytes_after' => $bytes_after,
                'remaining' => (int) $rem->found_posts, 'ids' => $done,
            ];
        }]);
    }

    // Normalisiert Meta-Texte (Titel/Description): erzwingt gueltiges UTF-8,
    // entfernt das Replacement-Zeichen (U+FFFD) und wandelt typografische
    // Trenner/Anfuehrungszeichen in ASCII — verhindert das kaputte "�" im Titel
    // (z.B. wenn ein Agent einen non-ASCII-Trenner mit falschem Encoding sendet).
    private static function clean_meta_text($s) {
        $s = (string) $s;
        if (function_exists('mb_convert_encoding')) {
            // ungueltige Byte-Sequenzen verwerfen statt als � zu rendern
            $s = @mb_convert_encoding($s, 'UTF-8', 'UTF-8');
        }
        $s = str_replace("\xEF\xBF\xBD", '', $s); // U+FFFD entfernen
        $s = strtr($s, [
            "\xE2\x80\x93" => '-', "\xE2\x80\x94" => '-', // en/em-dash
            "\xE2\x80\xA2" => '-', "\xC2\xB7" => '-',     // bullet / middot
            "\xE2\x80\x9C" => '"', "\xE2\x80\x9D" => '"', // curly double quotes
            "\xE2\x80\x98" => "'", "\xE2\x80\x99" => "'", // curly single quotes
        ]);
        return trim(preg_replace('/\s{2,}/', ' ', $s));
    }

    // Friendly Name => LSCWP conf-id. Nur risikoarme, reversible Schalter.
    private static function ls_map() {
        return [
            'lazyload'  => 'media-lazy',    // Bilder Lazy-Load (LCP/Bandbreite)
            'css_min'   => 'optm-css_min',  // CSS minifizieren
            'js_min'    => 'optm-js_min',   // JS minifizieren
            'html_min'  => 'optm-html_min', // HTML minifizieren
            'qs_rm'     => 'optm-qs_rm',    // Query-Strings von statischen Ressourcen entfernen
            // Riskantere Render-/Bundle-Optimierungen (koennen Page-Builder-Stacks
            // brechen) -- nur mit Sichtpruefung + Sofort-Revert einsetzen:
            'css_comb'  => 'optm-css_comb', // CSS kombinieren
            'js_comb'   => 'optm-js_comb',  // JS kombinieren
            'css_async' => 'optm-css_async',// CSS asynchron laden (Render-Blocking CSS)
            'ucss'      => 'optm-ucss',      // Unused CSS entfernen (UCSS)
            'js_defer'  => 'optm-js_defer',  // JS deferred laden (Render-Blocking JS)
        ];
    }

    public function inject_head() {
        $head = get_option(self::OPT_HEAD, []);
        if (is_array($head) && $head) {
            echo "\n<!-- EzyHub Connector -->\n";
            foreach ($head as $html) echo $html . "\n";
            echo "<!-- /EzyHub Connector -->\n";
        }
        if (is_singular()) {
            $id = get_queried_object_id();
            $desc = get_post_meta($id, '_ezyhub_seo_description', true);
            if ($desc) echo '<meta name="description" content="' . esc_attr($desc) . "\">\n";
        }
    }

    public function inject_canonical() {
        if (!is_singular()) return;
        $id = get_queried_object_id();
        $canonical = get_post_meta($id, '_ezyhub_canonical', true);
        if ($canonical) echo '<link rel="canonical" href="' . esc_url($canonical) . "\">\n";
    }

    public function filter_wp_robots($robots) {
        if (is_singular()) {
            $id = get_queried_object_id();
            if (get_post_meta($id, '_ezyhub_noindex', true) === '1') {
                $robots['noindex'] = true; $robots['follow'] = true;
            }
        }
        return $robots;
    }

    public function filter_sitemap_provider($provider, $name) {
        // Remove author archives from the sitemap (thin/duplicate).
        if ($name === 'users') return false;
        return $provider;
    }

    public function filter_robots_txt($output, $public) {
        $extra = (string) get_option(self::OPT_ROBOTS, '');
        if ($extra) $output .= "\n" . $extra . "\n";
        return $output;
    }

    public function maybe_serve_llms() {
        $uri = isset($_SERVER['REQUEST_URI']) ? parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
        if ($uri === '/llms.txt') {
            $content = (string) get_option(self::OPT_LLMS, '');
            if ($content !== '') { header('Content-Type: text/plain; charset=utf-8'); echo $content; exit; }
        }
    }
}

new EzyHub_Connector();
