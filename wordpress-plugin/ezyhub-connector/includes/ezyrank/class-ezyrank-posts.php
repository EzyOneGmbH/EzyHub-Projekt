<?php
/**
 * Beiträge aus EzyRank: Upsert über external_id, Teil-Update, Status,
 * Veröffentlichen, Verbindungstest (Kap. 7.4 / 7.5).
 *
 * Regeln:
 * - Über /posts nur draft oder pending; publish nur über /publish (Scope).
 * - Ein bereits veröffentlichter Beitrag wird durch ein Update NIE wieder
 *   zum Entwurf.
 * - Autor, Kategorien, Tags und Datum nur ändern, wenn mitgeschickt.
 * - Geändert werden nur Beiträge, die EzyRank selbst angelegt hat
 *   (Meta _ezyrank_external_id). Einzige Ausnahme: /replace-original
 *   (Scope publish) ersetzt den Beitrag, zu dem die Überarbeitung gehört.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Posts {
    const META_EXT = '_ezyrank_external_id';

    public static function find_by_external($external_id) {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT pm.post_id FROM {$wpdb->postmeta} pm
             JOIN {$wpdb->posts} p ON p.ID = pm.post_id
             WHERE pm.meta_key = %s AND pm.meta_value = %s AND p.post_status <> 'trash'
             ORDER BY pm.post_id ASC LIMIT 1",
            self::META_EXT,
            (string) $external_id
        ));
    }

    public static function is_ezyrank_post($id) {
        $p = get_post((int) $id);
        return $p && $p->post_type === 'post' && get_post_meta($p->ID, self::META_EXT, true) !== '';
    }

    public static function describe($id, $created = null) {
        $p = get_post((int) $id);
        $out = [
            'post_id'     => (int) $p->ID,
            'status'      => $p->post_status,
            'external_id' => (string) get_post_meta($p->ID, self::META_EXT, true),
            'edit_url'    => admin_url('post.php?post=' . (int) $p->ID . '&action=edit'),
            'preview_url' => get_preview_post_link($p),
            'permalink'   => get_permalink($p),
            'modified'    => mysql_to_rfc3339($p->post_modified_gmt),
        ];
        if ($created !== null) $out['created'] = (bool) $created;
        return $out;
    }

    private static function err($code, $msg, $status = 400) {
        return new WP_Error($code, $msg, ['status' => $status]);
    }

    /** Autor nur übernehmen, wenn er Beiträge bearbeiten darf. */
    private static function valid_author($id) {
        $u = get_userdata((int) $id);
        return $u && user_can($u, 'edit_posts') ? (int) $u->ID : 0;
    }

    public static function default_author() {
        $opt = self::valid_author((int) get_option('ezyrank_default_author', 0));
        if ($opt) return $opt;
        $admins = get_users(['role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ID']);
        return $admins ? (int) $admins[0] : 0;
    }

    /**
     * Bilder laden und {{img:n}}-Platzhalter ersetzen. Gibt [html, featured_id]
     * oder WP_Error zurück. Bilder zuerst, damit bei einem Bildfehler am
     * Beitrag nichts geändert wird.
     */
    private static function images($html, $params) {
        $featured = null;
        if (!empty($params['featured_image']['url'])) {
            $featured = EzyRank_Media::sideload($params['featured_image']['url'], $params['featured_image']['alt'] ?? '');
            if (is_wp_error($featured)) return $featured;
        }
        if (!empty($params['inline_images']) && is_array($params['inline_images'])) {
            foreach ($params['inline_images'] as $img) {
                if (empty($img['placeholder']) || empty($img['url'])) continue;
                if (!preg_match('/^\{\{img:\d+\}\}$/', (string) $img['placeholder'])) continue;
                $id = EzyRank_Media::sideload($img['url'], $img['alt'] ?? '');
                if (is_wp_error($id)) return $id;
                $src = wp_get_attachment_url($id);
                $html = str_replace((string) $img['placeholder'], esc_url($src), $html);
            }
        }
        return [$html, $featured];
    }

    /** POST /posts */
    public static function upsert($params) {
        $ext = isset($params['external_id']) ? (string) $params['external_id'] : '';
        if (!preg_match('/^[A-Za-z0-9-]{8,64}$/', $ext)) return self::err('ezr_invalid', 'external_id fehlt oder ist ungültig');
        $title = isset($params['title']) ? sanitize_text_field($params['title']) : '';
        if ($title === '') return self::err('ezr_invalid', 'title fehlt');
        $status = isset($params['status']) ? (string) $params['status'] : 'draft';
        if (!in_array($status, ['draft', 'pending'], true)) {
            return self::err('ezr_scope_missing', 'Veröffentlichen nur über /posts/{id}/publish.', 403);
        }

        $existing = self::find_by_external($ext);
        $res = self::images((string) ($params['content_html'] ?? ''), $params);
        if (is_wp_error($res)) {
            EzyRank_Logger::log('post.image_failed', $res->get_error_message(), 'ezr_image_failed', $existing);
            return $res;
        }
        list($html, $featured) = $res;

        $data = [
            'post_type'    => 'post',
            'post_title'   => $title,
            'post_content' => EzyRank_Sanitizer::clean($html),
            // Vorgabe Ezy One: Kommentare und Pings bei EzyRank-Beiträgen immer zu.
            'comment_status' => 'closed',
            'ping_status'    => 'closed',
        ];
        if (isset($params['excerpt'])) $data['post_excerpt'] = sanitize_textarea_field($params['excerpt']);
        if (isset($params['slug'])) $data['post_name'] = sanitize_title($params['slug']);

        if ($existing) {
            $data['ID'] = $existing;
            $cur = get_post_status($existing);
            // Live-Beiträge bleiben live; sonst den gewünschten Entwurfsstatus.
            if (!in_array($cur, ['publish', 'future', 'private'], true)) $data['post_status'] = $status;
        } else {
            $data['post_status'] = $status;
            $data['post_author'] = self::default_author();
        }
        if (isset($params['author_id'])) {
            $a = self::valid_author($params['author_id']);
            if (!$a) return self::err('ezr_invalid', 'author_id ist kein Benutzer mit Recht edit_posts');
            $data['post_author'] = $a;
        }
        if (!empty($params['published_at'])) {
            $ts = strtotime((string) $params['published_at']);
            if ($ts) {
                $data['post_date_gmt'] = gmdate('Y-m-d H:i:s', $ts);
                $data['post_date'] = get_date_from_gmt($data['post_date_gmt']);
                $data['edit_date'] = true;
            }
        }
        if (array_key_exists('category_ids', $params) && is_array($params['category_ids'])) {
            $cats = array_values(array_filter(array_map('intval', $params['category_ids']), function ($id) {
                return $id > 0 && term_exists($id, 'category');
            }));
            if ($cats) $data['post_category'] = $cats;
        }
        if (array_key_exists('tags', $params) && is_array($params['tags'])) {
            $data['tags_input'] = array_map('sanitize_text_field', $params['tags']);
        }

        // Inhalt ist bereits mit EzyRank_Sanitizer bereinigt; WordPress' eigener
        // kses-Filter (ohne eingeloggten Benutzer aktiv) würde sonst erlaubte
        // Elemente wie details/summary und YouTube-iframes entfernen.
        kses_remove_filters();
        $id = $existing ? wp_update_post(wp_slash($data), true) : wp_insert_post(wp_slash($data), true);
        kses_init();
        if (is_wp_error($id)) return self::err('ezr_save_failed', $id->get_error_message(), 500);

        update_post_meta($id, self::META_EXT, $ext);
        if ($featured) {
            set_post_thumbnail($id, $featured);
            if (!wp_get_post_parent_id($featured)) wp_update_post(['ID' => $featured, 'post_parent' => $id]);
        }
        if (array_key_exists('schema_jsonld', $params)) {
            if ($params['schema_jsonld'] === null) delete_post_meta($id, '_ezyrank_schema');
            elseif (is_array($params['schema_jsonld'])) update_post_meta($id, '_ezyrank_schema', wp_slash(wp_json_encode($params['schema_jsonld'])));
        }
        $seo = isset($params['seo']) && is_array($params['seo']) ? EzyRank_Seo::write($id, $params['seo']) : null;

        EzyRank_Logger::log($existing ? 'post.updated' : 'post.created', $title, '', $id);
        $out = self::describe($id, !$existing);
        $out['seo_plugin'] = $seo;
        return $out;
    }

    /** PATCH /posts/{id}: nur übergebene Felder, nur EzyRank-Beiträge. */
    public static function patch($id, $params) {
        if (!self::is_ezyrank_post($id)) return self::err('ezr_not_found', 'Kein von EzyRank angelegter Beitrag', 404);
        $params['external_id'] = (string) get_post_meta($id, self::META_EXT, true);
        $post = get_post($id);
        if (!isset($params['title'])) $params['title'] = $post->post_title;
        if (!array_key_exists('content_html', $params)) {
            // Inhalt unverändert lassen: kein Bild-/Sanitizer-Lauf über Bestand
            $data = ['ID' => (int) $id];
            if (isset($params['title'])) $data['post_title'] = sanitize_text_field($params['title']);
            if (isset($params['excerpt'])) $data['post_excerpt'] = sanitize_textarea_field($params['excerpt']);
            if (isset($params['author_id'])) {
                $a = self::valid_author($params['author_id']);
                if (!$a) return self::err('ezr_invalid', 'author_id ist kein Benutzer mit Recht edit_posts');
                $data['post_author'] = $a;
            }
            if (isset($params['category_ids']) && is_array($params['category_ids'])) {
                $data['post_category'] = array_values(array_filter(array_map('intval', $params['category_ids']), function ($c) {
                    return $c > 0 && term_exists($c, 'category');
                }));
            }
            if (isset($params['tags']) && is_array($params['tags'])) $data['tags_input'] = array_map('sanitize_text_field', $params['tags']);
            $r = wp_update_post(wp_slash($data), true);
            if (is_wp_error($r)) return self::err('ezr_save_failed', $r->get_error_message(), 500);
            if (isset($params['seo']) && is_array($params['seo'])) EzyRank_Seo::write($id, $params['seo']);
            EzyRank_Logger::log('post.patched', $post->post_title, '', $id);
            return self::describe($id, false);
        }
        if (!isset($params['status'])) $params['status'] = in_array($post->post_status, ['draft', 'pending'], true) ? $post->post_status : 'draft';
        return self::upsert($params);
    }

    /** POST /posts/{id}/publish (Scope publish). */
    public static function publish($id, $params) {
        if (!self::is_ezyrank_post($id)) return self::err('ezr_not_found', 'Kein von EzyRank angelegter Beitrag', 404);
        // Vorgabe Ezy One: Kommentare und Pings bleiben auch beim Livegang zu.
        $data = ['ID' => (int) $id, 'post_status' => 'publish', 'comment_status' => 'closed', 'ping_status' => 'closed'];
        if (!empty($params['date'])) {
            $ts = strtotime((string) $params['date']);
            if ($ts) {
                $data['post_date_gmt'] = gmdate('Y-m-d H:i:s', $ts);
                $data['post_date'] = get_date_from_gmt($data['post_date_gmt']);
                $data['edit_date'] = true;
                if ($ts > time()) $data['post_status'] = 'future';
            }
        }
        $r = wp_update_post($data, true);
        if (is_wp_error($r)) return self::err('ezr_save_failed', $r->get_error_message(), 500);
        EzyRank_Logger::log('post.published', get_the_title($id), '', $id);
        $out = self::describe($id, false);
        // Geplante Beiträge sind noch nicht erreichbar: erst melden, wenn live.
        if ($out['status'] === 'publish') $out['indexnow'] = EzyRank_Indexnow::ping($out['permalink']);
        return $out;
    }

    /** POST /posts/{id}/indexnow (Scope publish): Live-Beitrag erneut melden. */
    public static function indexnow($id) {
        $p = get_post((int) $id);
        if (!$p || $p->post_type !== 'post') return self::err('ezr_not_found', 'Beitrag nicht gefunden', 404);
        if ($p->post_status !== 'publish') return self::err('ezr_invalid', 'Der Beitrag ist nicht veröffentlicht');
        $out = self::describe($p->ID);
        $out['indexnow'] = EzyRank_Indexnow::ping($out['permalink']);
        return $out;
    }

    /**
     * POST /posts/{id}/replace-original (Scope publish, ab 2.1.0).
     * Ersetzt einen bestehenden, veröffentlichten Beitrag durch den Inhalt des
     * EzyRank-Entwurfs {id}. URL, Datum, Autor, Kategorien und Tags des
     * Originals bleiben. WordPress legt dabei eine Revision an: Der alte Stand
     * lässt sich im Editor wiederherstellen. Der Entwurf wandert in den
     * Papierkorb, seine EzyHub-ID geht auf das Original über.
     */
    public static function replace_original($id, $params) {
        if (!self::is_ezyrank_post($id)) return self::err('ezr_not_found', 'Kein von EzyRank angelegter Beitrag', 404);
        $draft = get_post((int) $id);
        if (in_array($draft->post_status, ['publish', 'future', 'private', 'trash'], true)) {
            return self::err('ezr_invalid', 'Die Überarbeitung ist kein Entwurf mehr');
        }
        $url = isset($params['original_url']) ? esc_url_raw((string) $params['original_url']) : '';
        $target_id = $url !== '' ? (int) url_to_postid($url) : 0;
        $target = $target_id ? get_post($target_id) : null;
        if (!$target || $target->post_type !== 'post' || $target->post_status !== 'publish' || $target_id === (int) $id) {
            return self::err('ezr_original_not_found', 'Zur Original-URL gibt es keinen veröffentlichten Beitrag', 404);
        }

        $data = [
            'ID'             => $target_id,
            // Inhalt wurde beim Anlegen des Entwurfs bereits bereinigt.
            'post_content'   => $draft->post_content,
            'comment_status' => 'closed',
            'ping_status'    => 'closed',
        ];
        $title = isset($params['title']) ? sanitize_text_field($params['title']) : '';
        if ($title !== '') $data['post_title'] = $title;
        if ($draft->post_excerpt !== '') $data['post_excerpt'] = $draft->post_excerpt;

        kses_remove_filters();
        $r = wp_update_post(wp_slash($data), true);
        kses_init();
        if (is_wp_error($r)) return self::err('ezr_save_failed', $r->get_error_message(), 500);

        $thumb = (int) get_post_thumbnail_id($id);
        if ($thumb) set_post_thumbnail($target_id, $thumb);
        $schema = get_post_meta($id, '_ezyrank_schema', true);
        if ($schema !== '') update_post_meta($target_id, '_ezyrank_schema', wp_slash($schema));
        if (isset($params['seo']) && is_array($params['seo'])) EzyRank_Seo::write($target_id, $params['seo']);

        // EzyHub-ID umhängen, damit spätere Änderungen das Original treffen.
        $ext = (string) get_post_meta($id, self::META_EXT, true);
        delete_post_meta($id, self::META_EXT);
        update_post_meta($target_id, self::META_EXT, $ext);
        wp_trash_post($id);

        EzyRank_Logger::log('post.replaced', get_the_title($target_id), '', $target_id);
        $out = self::describe($target_id, false);
        $out['replaced_draft_id'] = (int) $id;
        $out['indexnow'] = EzyRank_Indexnow::ping($out['permalink']);
        return $out;
    }

    /** POST /test: Testentwurf anlegen und sofort endgültig löschen. */
    public static function test() {
        $t0 = microtime(true);
        $id = wp_insert_post([
            'post_type'   => 'post',
            'post_status' => 'draft',
            'post_title'  => 'EzyRank Verbindungstest',
            'post_content' => '',
            'post_author' => self::default_author(),
        ], true);
        if (is_wp_error($id)) {
            EzyRank_Logger::log('test.failed', $id->get_error_message(), 'ezr_save_failed');
            return self::err('ezr_save_failed', 'Testentwurf konnte nicht angelegt werden: ' . $id->get_error_message(), 500);
        }
        $deleted = (bool) wp_delete_post($id, true);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        EzyRank_Logger::log('test.ok', 'Verbindungstest erfolgreich (' . $ms . ' ms)');
        return ['ok' => true, 'created_and_deleted' => $deleted, 'ms' => $ms];
    }
}
