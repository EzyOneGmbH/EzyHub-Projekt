<?php
/**
 * Admin-Seite «Einstellungen › EzyRank» (Kap. 7.9). Nur für manage_options,
 * jedes Formular mit Nonce. Der Schlüssel wird genau einmal angezeigt.
 */

if (!defined('ABSPATH')) exit;

class EzyRank_Admin {
    const SLUG = 'ezyrank';

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_post_ezyrank_generate_key', [__CLASS__, 'handle_generate']);
        add_action('admin_post_ezyrank_save_settings', [__CLASS__, 'handle_settings']);
    }

    public static function menu() {
        // Eigener Punkt im Hauptmenü (ab 2.1.1), vorher unter «Einstellungen».
        add_menu_page('EzyRank', 'EzyRank', 'manage_options', self::SLUG, [__CLASS__, 'render'], 'dashicons-chart-line', 81);
    }

    private static function back($msg = '') {
        wp_safe_redirect(add_query_arg(['page' => self::SLUG, 'ezr_msg' => $msg], admin_url('admin.php')));
        exit;
    }

    public static function handle_generate() {
        if (!current_user_can('manage_options')) wp_die('Keine Berechtigung', 403);
        check_admin_referer('ezyrank_generate_key');
        $key = EzyRank_Auth::generate_key();
        // Einmalige Anzeige: nur für diesen Benutzer, 2 Minuten, nach dem Anzeigen gelöscht.
        set_transient('ezyrank_newkey_' . get_current_user_id(), $key, 120);
        self::back('key');
    }

    public static function handle_settings() {
        if (!current_user_can('manage_options')) wp_die('Keine Berechtigung', 403);
        check_admin_referer('ezyrank_save_settings');
        $publish = !empty($_POST['scope_publish']) ? '1' : '0';
        if ($publish !== get_option(EzyRank_Auth::OPT_PUBLISH, '0')) {
            EzyRank_Logger::log('scope.changed', $publish === '1' ? 'Berechtigung «publish» aktiviert' : 'Berechtigung «publish» deaktiviert');
        }
        update_option(EzyRank_Auth::OPT_PUBLISH, $publish, false);
        $author = isset($_POST['default_author']) ? (int) $_POST['default_author'] : 0;
        $u = $author ? get_userdata($author) : null;
        update_option('ezyrank_default_author', $u && user_can($u, 'edit_posts') ? $author : 0, false);
        self::back('saved');
    }

    public static function render() {
        if (!current_user_can('manage_options')) return;
        $uid = get_current_user_id();
        $newkey = get_transient('ezyrank_newkey_' . $uid);
        if ($newkey) delete_transient('ezyrank_newkey_' . $uid);
        $msg = isset($_GET['ezr_msg']) ? sanitize_key($_GET['ezr_msg']) : '';
        $has = EzyRank_Auth::has_key();
        $last_ok = (int) get_option('ezyrank_last_ok', 0);
        $last_err = get_option('ezyrank_last_error', null);
        $publish = get_option(EzyRank_Auth::OPT_PUBLISH, '0') === '1';
        $authors = get_users(['capability' => 'edit_posts', 'number' => 200, 'orderby' => 'display_name']);
        $default_author = (int) get_option('ezyrank_default_author', 0);
        $fmt = function ($t) { return $t ? wp_date('d.m.Y H:i', (int) $t) : '–'; };
        ?>
        <div class="wrap">
            <h1>EzyRank</h1>
            <p>Verbindet diese Website mit dem Blog-Autopiloten von EzyRank (EzyHub). Artikel kommen
               als <strong>Entwurf</strong> an; live geht nur, was freigegeben wurde.</p>

            <?php if ($msg === 'saved'): ?>
                <div class="notice notice-success"><p>Einstellungen gespeichert.</p></div>
            <?php endif; ?>

            <?php if ($newkey): ?>
                <div class="notice notice-warning" style="padding:12px 14px">
                    <p><strong>Dein Verbindungsschlüssel – wird nur jetzt angezeigt.</strong>
                       Kopiere ihn und füge ihn in EzyHub ein. Danach ist er hier nur noch maskiert sichtbar.</p>
                    <p><input type="text" readonly id="ezyrank-key" value="<?php echo esc_attr($newkey); ?>"
                              style="width:100%;max-width:520px;font-family:monospace" onclick="this.select()" />
                       <button type="button" class="button" onclick="var f=document.getElementById('ezyrank-key');f.select();navigator.clipboard&&navigator.clipboard.writeText(f.value);this.textContent='Kopiert';">Kopieren</button></p>
                </div>
            <?php endif; ?>

            <h2>Verbindung</h2>
            <table class="form-table" role="presentation">
                <tr><th scope="row">Schlüssel</th><td>
                    <?php if ($has): ?>
                        <code>ezr_••••••••••••<?php echo esc_html((string) get_option(EzyRank_Auth::OPT_LAST4, '')); ?></code>
                        <span class="description"> erzeugt am <?php echo esc_html($fmt(get_option(EzyRank_Auth::OPT_CREATED, 0))); ?></span>
                    <?php else: ?>
                        <em>Noch kein Schlüssel erzeugt.</em>
                    <?php endif; ?>
                </td></tr>
                <tr><th scope="row">Zuletzt erfolgreich</th><td><?php echo esc_html($fmt($last_ok)); ?></td></tr>
                <tr><th scope="row">Letzter Fehler</th><td>
                    <?php if (is_array($last_err)): ?>
                        <code><?php echo esc_html($last_err['code']); ?></code>
                        <?php echo esc_html($last_err['message']); ?> (<?php echo esc_html($fmt($last_err['t'])); ?>)
                    <?php else: ?>–<?php endif; ?>
                </td></tr>
            </table>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                  <?php if ($has): ?>onsubmit="return confirm('Neuen Schlüssel erzeugen? Der bisherige Schlüssel ist dann sofort ungültig und muss in EzyHub ersetzt werden.');"<?php endif; ?>>
                <input type="hidden" name="action" value="ezyrank_generate_key" />
                <?php wp_nonce_field('ezyrank_generate_key'); ?>
                <?php submit_button($has ? 'Schlüssel neu erzeugen' : 'Verbindungsschlüssel erzeugen', $has ? 'secondary' : 'primary', 'submit', false); ?>
                <a class="button" style="margin-left:8px" href="<?php echo esc_url('https://' . EZYRANK_API_HOST . '/ezyrank'); ?>" target="_blank" rel="noopener">In EzyHub öffnen</a>
            </form>

            <h2>Berechtigungen und Autor</h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="ezyrank_save_settings" />
                <?php wp_nonce_field('ezyrank_save_settings'); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row">Lesen, Entwürfe anlegen</th><td>Immer aktiv (Beiträge, Kategorien, Autoren lesen; Entwürfe und Bilder anlegen).</td></tr>
                    <tr><th scope="row"><label for="ezr-publish">Veröffentlichen</label></th><td>
                        <label><input type="checkbox" id="ezr-publish" name="scope_publish" value="1" <?php checked($publish); ?> />
                        EzyRank darf freigegebene Artikel selbst veröffentlichen</label>
                        <p class="description">Achtung: Ist das aktiv, schaltet EzyRank einen Artikel live, sobald er in EzyHub freigegeben wurde. Ohne diesen Schalter veröffentlichst du in WordPress selbst.</p>
                    </td></tr>
                    <tr><th scope="row"><label for="ezr-author">Standard-Autor</label></th><td>
                        <select id="ezr-author" name="default_author">
                            <option value="0">Erster Administrator</option>
                            <?php foreach ($authors as $a): ?>
                                <option value="<?php echo (int) $a->ID; ?>" <?php selected($default_author, (int) $a->ID); ?>><?php echo esc_html($a->display_name); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </td></tr>
                </table>
                <?php submit_button('Speichern'); ?>
            </form>

            <h2>Protokoll</h2>
            <table class="widefat striped">
                <thead><tr><th>Zeit</th><th>Ereignis</th><th>Details</th><th>Code</th><th>Beitrag</th></tr></thead>
                <tbody>
                <?php $log = EzyRank_Logger::all(); if (!$log): ?>
                    <tr><td colspan="5">Noch keine Ereignisse.</td></tr>
                <?php else: foreach ($log as $e): ?>
                    <tr>
                        <td><?php echo esc_html($fmt($e['t'] ?? 0)); ?></td>
                        <td><code><?php echo esc_html($e['type'] ?? ''); ?></code></td>
                        <td><?php echo esc_html($e['message'] ?? ''); ?></td>
                        <td><?php echo esc_html($e['code'] ?? ''); ?></td>
                        <td><?php if (!empty($e['post_id'])): ?><a href="<?php echo esc_url(get_edit_post_link((int) $e['post_id'])); ?>">#<?php echo (int) $e['post_id']; ?></a><?php endif; ?></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }
}
