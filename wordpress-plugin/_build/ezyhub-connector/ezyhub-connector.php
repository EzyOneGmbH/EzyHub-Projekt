<?php
/**
 * Plugin Name: EzyHub Connector
 * Description: Lässt EzyHub technische SEO-Maßnahmen autonom deployen — globale <head>-Injektion (JSON-LD, OG, Meta), llms.txt und Seiten-Meta. Authentifiziert über WordPress Application Passwords (manage_options). Alle Änderungen sind über dieses Plugin nachvollziehbar und reversibel.
 * Version: 1.0.0
 * Author: EzyOne GmbH
 * License: GPL-2.0+
 */

if (!defined('ABSPATH')) exit;

class EzyHub_Connector {
    const OPT_HEAD   = 'ezyhub_head_html';   // global <head> snippets (assoc: key => html)
    const OPT_LLMS   = 'ezyhub_llms_txt';    // llms.txt content
    const NS         = 'ezyhub/v1';

    public function __construct() {
        add_action('rest_api_init', [$this, 'routes']);
        add_action('wp_head', [$this, 'inject_head'], 99);
        add_action('init', [$this, 'maybe_serve_llms']);
    }

    /** Only EzyHub (admin via Application Password) may write. */
    public function can_write() {
        return current_user_can('manage_options');
    }

    public function routes() {
        register_rest_route(self::NS, '/status', [
            'methods'  => 'GET',
            'callback' => function () {
                $head = get_option(self::OPT_HEAD, []);
                return [
                    'ok' => true,
                    'plugin' => 'ezyhub-connector',
                    'version' => '1.0.0',
                    'headKeys' => is_array($head) ? array_keys($head) : [],
                    'llmsBytes' => strlen((string) get_option(self::OPT_LLMS, '')),
                ];
            },
            'permission_callback' => [$this, 'can_write'],
        ]);

        // Set/replace a named global <head> snippet (e.g. "organization-jsonld").
        register_rest_route(self::NS, '/head', [
            'methods'  => 'POST',
            'callback' => function ($req) {
                $key  = sanitize_key($req['key'] ?? '');
                $html = (string) ($req['html'] ?? '');
                if (!$key) return new WP_Error('bad_key', 'key erforderlich', ['status' => 400]);
                $head = get_option(self::OPT_HEAD, []);
                if (!is_array($head)) $head = [];
                if ($html === '') unset($head[$key]);
                else $head[$key] = $html;
                update_option(self::OPT_HEAD, $head);
                return ['ok' => true, 'key' => $key, 'keys' => array_keys($head)];
            },
            'permission_callback' => [$this, 'can_write'],
        ]);

        // Set llms.txt content (served at /llms.txt).
        register_rest_route(self::NS, '/llms-txt', [
            'methods'  => 'POST',
            'callback' => function ($req) {
                update_option(self::OPT_LLMS, (string) ($req['content'] ?? ''));
                return ['ok' => true, 'bytes' => strlen((string) get_option(self::OPT_LLMS, ''))];
            },
            'permission_callback' => [$this, 'can_write'],
        ]);

        // Set a page's SEO title/description via native post meta (theme-independent
        // fallback that many themes/plugins read; also stored for transparency).
        register_rest_route(self::NS, '/page-meta', [
            'methods'  => 'POST',
            'callback' => function ($req) {
                $id = intval($req['postId'] ?? 0);
                if (!$id || !get_post($id)) return new WP_Error('bad_id', 'gültige postId erforderlich', ['status' => 400]);
                if (isset($req['seoTitle']))       update_post_meta($id, '_ezyhub_seo_title', sanitize_text_field($req['seoTitle']));
                if (isset($req['seoDescription'])) update_post_meta($id, '_ezyhub_seo_description', sanitize_text_field($req['seoDescription']));
                return ['ok' => true, 'postId' => $id];
            },
            'permission_callback' => [$this, 'can_write'],
        ]);
    }

    /** Inject all stored snippets into <head>. */
    public function inject_head() {
        $head = get_option(self::OPT_HEAD, []);
        if (!is_array($head)) return;
        echo "\n<!-- EzyHub Connector -->\n";
        foreach ($head as $key => $html) {
            echo $html . "\n";
        }
        echo "<!-- /EzyHub Connector -->\n";

        // Per-page SEO title/description override (only if a value is set).
        if (is_singular()) {
            $id = get_queried_object_id();
            $desc = get_post_meta($id, '_ezyhub_seo_description', true);
            if ($desc) echo '<meta name="description" content="' . esc_attr($desc) . "\">\n";
        }
    }

    /** Serve /llms.txt from the stored option. */
    public function maybe_serve_llms() {
        $uri = isset($_SERVER['REQUEST_URI']) ? parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
        if ($uri === '/llms.txt') {
            $content = (string) get_option(self::OPT_LLMS, '');
            if ($content !== '') {
                header('Content-Type: text/plain; charset=utf-8');
                echo $content;
                exit;
            }
        }
    }
}

new EzyHub_Connector();
