<?php
/**
 * SEO-Felder je aktivem SEO-Plugin (Kap. 7.6). Alle Meta-Schlüssel liegen in
 * MAP, damit Änderungen der SEO-Plugins an einer Stelle angepasst werden.
 * Ohne SEO-Plugin gibt EzyRank Titel und Meta-Description selbst aus.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Seo {
    const MAP = [
        'yoast'    => ['title' => '_yoast_wpseo_title',     'description' => '_yoast_wpseo_metadesc', 'focus' => '_yoast_wpseo_focuskw'],
        'rankmath' => ['title' => 'rank_math_title',        'description' => 'rank_math_description', 'focus' => 'rank_math_focus_keyword'],
        'seopress' => ['title' => '_seopress_titles_title', 'description' => '_seopress_titles_desc', 'focus' => '_seopress_analysis_target_kw'],
        'aioseo'   => ['title' => '_aioseo_title',          'description' => '_aioseo_description',   'focus' => '_aioseo_keywords'],
    ];
    const FALLBACK_TITLE = '_ezyrank_seo_title';
    const FALLBACK_DESC  = '_ezyrank_seo_description';

    /** Aktive SEO-Plugins (Filter ezyrank_active_seo_plugins für Tests). */
    public static function active() {
        $a = [];
        if (defined('WPSEO_VERSION')) $a[] = 'yoast';
        if (defined('RANK_MATH_VERSION') || class_exists('RankMath')) $a[] = 'rankmath';
        if (defined('SEOPRESS_VERSION')) $a[] = 'seopress';
        if (defined('AIOSEO_VERSION') || function_exists('aioseo')) $a[] = 'aioseo';
        return array_values(array_intersect(array_keys(self::MAP), (array) apply_filters('ezyrank_active_seo_plugins', $a)));
    }

    public static function primary() {
        $a = self::active();
        return $a ? $a[0] : null;
    }

    /** $seo = ['title' => …, 'description' => …, 'focus_keyword' => …]; nur Mitgeschicktes wird geschrieben. */
    public static function write($post_id, $seo) {
        if (!is_array($seo)) return null;
        $vals = [];
        if (isset($seo['title'])) $vals['title'] = sanitize_text_field($seo['title']);
        if (isset($seo['description'])) $vals['description'] = sanitize_textarea_field($seo['description']);
        if (isset($seo['focus_keyword'])) $vals['focus'] = sanitize_text_field($seo['focus_keyword']);
        if (!$vals) return null;

        $plugin = self::primary();
        if ($plugin === null) {
            if (isset($vals['title'])) update_post_meta($post_id, self::FALLBACK_TITLE, $vals['title']);
            if (isset($vals['description'])) update_post_meta($post_id, self::FALLBACK_DESC, $vals['description']);
            return 'ezyrank';
        }
        $map = self::MAP[$plugin];
        foreach ($vals as $k => $v) update_post_meta($post_id, $map[$k], $v);

        // AIOSEO 4 liest aus der eigenen Tabelle, nicht aus Post-Meta.
        if ($plugin === 'aioseo' && class_exists('\\AIOSEO\\Plugin\\Common\\Models\\Post')) {
            try {
                $p = \AIOSEO\Plugin\Common\Models\Post::getPost($post_id);
                $p->post_id = $post_id;
                if (isset($vals['title'])) $p->title = $vals['title'];
                if (isset($vals['description'])) $p->description = $vals['description'];
                if (isset($vals['focus'])) $p->keyphrases = wp_json_encode(['focus' => ['keyphrase' => $vals['focus']], 'additional' => []]);
                $p->save();
            } catch (\Throwable $e) {
                EzyRank_Logger::log('seo.aioseo_failed', $e->getMessage(), '', $post_id);
            }
        }
        return $plugin;
    }

    // ── Ausgabe ohne SEO-Plugin ──────────────────────────────────────────────
    public static function filter_title($title) {
        if (self::primary() !== null || !is_singular('post')) return $title;
        $t = (string) get_post_meta(get_queried_object_id(), self::FALLBACK_TITLE, true);
        return $t !== '' ? $t : $title;
    }

    public static function meta_description() {
        if (self::primary() !== null || !is_singular('post')) return;
        $d = (string) get_post_meta(get_queried_object_id(), self::FALLBACK_DESC, true);
        if ($d !== '') echo '<meta name="description" content="' . esc_attr($d) . "\" />\n";
    }

    /** JSON-LD aus dem separaten Feld (Kap. 7.7), nur für den jeweiligen Beitrag. */
    public static function jsonld() {
        if (!is_singular('post')) return;
        $json = (string) get_post_meta(get_queried_object_id(), '_ezyrank_schema', true);
        if ($json === '') return;
        $data = json_decode($json, true);
        if (!is_array($data)) return;
        echo '<script type="application/ld+json">' . wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) . "</script>\n";
    }
}
