<?php
/**
 * Plugin Name: EzyHub Connector
 * Description: Lässt EzyHub technische SEO-Maßnahmen autonom deployen — <head>-Injektion (JSON-LD, OG, Meta), llms.txt, Seiten-Meta, Canonical/Noindex, robots.txt, Sitemap-Optimierung, Bild-Alt-Texte und Elementor-Editing (Headings + Text-Widgets) mit automatischem Backup/Restore. Auth via Application Passwords (manage_options). Alle Änderungen reversibel.
 * Version: 1.4.0
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
            if ($t) return $t;
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
                'ok' => true, 'plugin' => 'ezyhub-connector', 'version' => '1.4.0',
                'headKeys' => is_array($head) ? array_keys($head) : [],
                'llmsBytes' => strlen((string) get_option(self::OPT_LLMS, '')),
                'robotsBytes' => strlen((string) get_option(self::OPT_ROBOTS, '')),
                'elementorActive' => did_action('elementor/loaded') || defined('ELEMENTOR_VERSION'),
            ];
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
            if (isset($r['seoTitle']))       update_post_meta($id, '_ezyhub_seo_title', sanitize_text_field($r['seoTitle']));
            if (isset($r['seoDescription'])) update_post_meta($id, '_ezyhub_seo_description', sanitize_text_field($r['seoDescription']));
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
