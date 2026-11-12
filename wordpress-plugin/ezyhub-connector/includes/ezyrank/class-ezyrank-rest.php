<?php
/**
 * REST-Routen der EzyRank-Schnittstelle (Namespace ezyrank/v1, Kap. 7.4).
 * Jede Route verlangt den Verbindungsschlüssel — es gibt keinen öffentlichen
 * Endpunkt, auch /health und /test nicht.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Rest {
    const NS = 'ezyrank/v1';

    public static function register() {
        $read = EzyRank_Auth::permission('read');
        $draft = EzyRank_Auth::permission('draft');
        $publish = EzyRank_Auth::permission('publish');

        register_rest_route(self::NS, '/health', ['methods' => 'GET', 'permission_callback' => $read, 'callback' => function () {
            return [
                'ok'             => true,
                'site_url'       => home_url('/'),
                'wp_version'     => get_bloginfo('version'),
                'plugin_version' => EzyHub_Connector::VERSION,
            ];
        }]);

        register_rest_route(self::NS, '/capabilities', ['methods' => 'GET', 'permission_callback' => $read, 'callback' => function () {
            $gutenberg = function_exists('use_block_editor_for_post_type') ? use_block_editor_for_post_type('post') : false;
            return [
                'scopes'         => EzyRank_Auth::scopes(),
                'seo_plugins'    => EzyRank_Seo::active(),
                'seo_plugin'     => EzyRank_Seo::primary(),
                'editor'         => $gutenberg ? 'gutenberg' : 'classic',
                'image_formats'  => array_values(array_unique(array_values(EzyRank_Media::TYPES))),
                'features'       => ['upsert', 'patch', 'media', 'publish', 'replace', 'indexnow', 'jsonld', 'test'],
                'timezone'       => wp_timezone_string(),
                'plugin_version' => EzyHub_Connector::VERSION,
            ];
        }]);

        register_rest_route(self::NS, '/taxonomies', ['methods' => 'GET', 'permission_callback' => $read, 'callback' => function () {
            $cats = get_terms(['taxonomy' => 'category', 'hide_empty' => false, 'number' => 500]);
            $tags = get_terms(['taxonomy' => 'post_tag', 'hide_empty' => false, 'number' => 500, 'orderby' => 'count', 'order' => 'DESC']);
            $map = function ($t) { return ['id' => (int) $t->term_id, 'name' => $t->name, 'slug' => $t->slug, 'parent' => (int) $t->parent, 'count' => (int) $t->count]; };
            return [
                'categories' => is_wp_error($cats) ? [] : array_map($map, $cats),
                'tags'       => is_wp_error($tags) ? [] : array_map($map, $tags),
                'default_category' => (int) get_option('default_category'),
            ];
        }]);

        register_rest_route(self::NS, '/authors', ['methods' => 'GET', 'permission_callback' => $read, 'callback' => function () {
            $users = get_users(['capability' => 'edit_posts', 'number' => 200, 'orderby' => 'display_name']);
            return [
                'authors' => array_map(function ($u) { return ['id' => (int) $u->ID, 'name' => $u->display_name]; }, $users),
                'default_author' => EzyRank_Posts::default_author(),
            ];
        }]);

        register_rest_route(self::NS, '/posts/(?P<id>\d+)', [
            ['methods' => 'GET', 'permission_callback' => $read, 'callback' => function ($r) {
                $p = get_post((int) $r['id']);
                if (!$p || $p->post_type !== 'post') return new WP_Error('ezr_not_found', 'Beitrag nicht gefunden', ['status' => 404]);
                return EzyRank_Posts::describe($p->ID);
            }],
            ['methods' => 'PATCH', 'permission_callback' => $draft, 'callback' => function ($r) {
                return EzyRank_Posts::patch((int) $r['id'], (array) $r->get_json_params());
            }],
        ]);

        register_rest_route(self::NS, '/posts/by-external/(?P<external_id>[A-Za-z0-9-]{8,64})', ['methods' => 'GET', 'permission_callback' => $read, 'callback' => function ($r) {
            $id = EzyRank_Posts::find_by_external((string) $r['external_id']);
            if (!$id) return new WP_Error('ezr_not_found', 'Kein Beitrag zu dieser EzyHub-ID', ['status' => 404]);
            return EzyRank_Posts::describe($id);
        }]);

        register_rest_route(self::NS, '/posts', ['methods' => 'POST', 'permission_callback' => $draft, 'callback' => function ($r) {
            return EzyRank_Posts::upsert((array) $r->get_json_params());
        }]);

        register_rest_route(self::NS, '/posts/(?P<id>\d+)/publish', ['methods' => 'POST', 'permission_callback' => $publish, 'callback' => function ($r) {
            return EzyRank_Posts::publish((int) $r['id'], (array) $r->get_json_params());
        }]);

        register_rest_route(self::NS, '/posts/(?P<id>\d+)/replace-original', ['methods' => 'POST', 'permission_callback' => $publish, 'callback' => function ($r) {
            return EzyRank_Posts::replace_original((int) $r['id'], (array) $r->get_json_params());
        }]);

        register_rest_route(self::NS, '/posts/(?P<id>\d+)/indexnow', ['methods' => 'POST', 'permission_callback' => $publish, 'callback' => function ($r) {
            return EzyRank_Posts::indexnow((int) $r['id']);
        }]);

        register_rest_route(self::NS, '/media', ['methods' => 'POST', 'permission_callback' => $draft, 'callback' => function ($r) {
            $p = (array) $r->get_json_params();
            $id = EzyRank_Media::sideload($p['url'] ?? '', $p['alt'] ?? '', (int) ($p['post_id'] ?? 0));
            if (is_wp_error($id)) {
                EzyRank_Logger::log('media.failed', $id->get_error_message(), 'ezr_image_failed');
                return $id;
            }
            return ['id' => (int) $id, 'url' => wp_get_attachment_url($id)];
        }]);

        register_rest_route(self::NS, '/test', ['methods' => 'POST', 'permission_callback' => $draft, 'callback' => function () {
            return EzyRank_Posts::test();
        }]);
    }
}
