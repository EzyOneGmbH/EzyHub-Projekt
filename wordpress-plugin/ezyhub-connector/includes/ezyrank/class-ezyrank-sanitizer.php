<?php
/**
 * HTML-Filter für Artikel aus EzyRank (Kap. 7.7): feste Erlaubt-Liste,
 * keine Skripte, keine Event-Attribute, Inline-Styles nur text-align,
 * iframes nur von YouTube (embed / nocookie).
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Sanitizer {
    public static function allowed() {
        $a = ['class' => true, 'id' => true, 'style' => true];
        $cell = $a + ['colspan' => true, 'rowspan' => true, 'scope' => true];
        return [
            'h2' => $a, 'h3' => $a, 'h4' => $a, 'p' => $a,
            'ul' => $a, 'ol' => $a + ['start' => true], 'li' => $a,
            'a' => ['href' => true, 'rel' => true, 'target' => true, 'title' => true],
            'strong' => [], 'b' => [], 'em' => [], 'i' => [], 'br' => [], 'hr' => [],
            'blockquote' => $a + ['cite' => true],
            'figure' => $a, 'figcaption' => $a,
            'img' => ['src' => true, 'alt' => true, 'width' => true, 'height' => true, 'loading' => true, 'class' => true],
            'table' => $a, 'thead' => $a, 'tbody' => $a, 'tfoot' => $a, 'tr' => $a,
            'th' => $cell, 'td' => $cell, 'caption' => $a,
            'details' => $a + ['open' => true], 'summary' => $a,
            'iframe' => ['src' => true, 'width' => true, 'height' => true, 'title' => true,
                         'allow' => true, 'allowfullscreen' => true, 'loading' => true, 'frameborder' => true],
        ];
    }

    public static function clean($html) {
        $html = (string) $html;
        // Skript-/Style-Blöcke samt Inhalt entfernen (wp_kses entfernt nur die Tags).
        $html = preg_replace('#<(script|style|noscript)\b[^>]*>.*?</\1\s*>#is', '', $html);
        add_filter('safe_style_css', [__CLASS__, 'only_text_align'], 999);
        $html = wp_kses($html, self::allowed(), ['http', 'https', 'mailto', 'tel']);
        remove_filter('safe_style_css', [__CLASS__, 'only_text_align'], 999);
        // iframes nur von YouTube
        $html = preg_replace_callback('#<iframe\b[^>]*>.*?</iframe>|<iframe\b[^>]*/?>#is', function ($m) {
            if (preg_match('#\ssrc=["\']https://(www\.)?(youtube-nocookie\.com/embed/|youtube\.com/embed/)[^"\']+["\']#i', $m[0])) return $m[0];
            return '';
        }, $html);
        return $html;
    }

    public static function only_text_align($props) {
        return ['text-align'];
    }
}
