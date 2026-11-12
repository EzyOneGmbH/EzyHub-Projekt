<?php
/**
 * PHPUnit (WP-Testsuite) für die EzyRank-Schnittstelle, Bauanleitung Kap. 10.
 */

class Test_EzyRank_Api extends WP_UnitTestCase {
    /** @var WP_REST_Server */
    private $server;
    private $key;
    private $ip = 0;
    private $pings = [];

    public function set_up() {
        parent::set_up();
        global $wp_rest_server;
        $this->server = $wp_rest_server = new WP_REST_Server();
        do_action('rest_api_init');
        $_SERVER['HTTPS'] = 'on';
        $this->neue_ip();
        update_option('ezyrank_scope_publish', '0');
        remove_all_filters('ezyrank_active_seo_plugins');
        self::factory()->user->create(['role' => 'administrator']);
        $this->key = EzyRank_Auth::generate_key();
        // IndexNow nie wirklich aufrufen: Anfragen abfangen und mitzählen.
        $this->pings = [];
        add_filter('pre_http_request', function ($pre, $args, $url) {
            if (strpos($url, 'api.indexnow.org') === false) return $pre;
            $this->pings[] = json_decode($args['body'], true);
            return ['response' => ['code' => 200, 'message' => 'OK'], 'body' => '', 'headers' => [], 'cookies' => []];
        }, 10, 3);
    }

    public function tear_down() {
        global $wp_rest_server;
        $wp_rest_server = null;
        unset($_SERVER['HTTPS']);
        parent::tear_down();
    }

    private function neue_ip() {
        $this->ip++;
        $_SERVER['REMOTE_ADDR'] = '203.0.113.' . $this->ip;
    }

    private function req($method, $path, $body = null, $key = true) {
        $r = new WP_REST_Request($method, '/ezyrank/v1' . $path);
        if ($key === true) $r->set_header('authorization', 'Bearer ' . $this->key);
        elseif (is_string($key)) $r->set_header('authorization', 'Bearer ' . $key);
        if ($body !== null) {
            $r->set_header('content-type', 'application/json');
            $r->set_body(wp_json_encode($body));
        }
        return $this->server->dispatch($r);
    }

    private function code($res) {
        $d = $res->get_data();
        return is_array($d) && isset($d['code']) ? $d['code'] : null;
    }

    private function artikel($extra = []) {
        return array_merge([
            'external_id'  => 'b0c1d2e3-0000-4000-8000-000000000001',
            'title'        => 'Trinkwasser in Afrika spenden',
            'slug'         => 'trinkwasser-afrika-spenden',
            'status'       => 'draft',
            'content_html' => '<h2>Warum</h2><p>Text</p>',
            'excerpt'      => 'Kurz',
        ], $extra);
    }

    private function alle_routen() {
        return [
            ['GET', '/health'], ['GET', '/capabilities'], ['GET', '/taxonomies'], ['GET', '/authors'],
            ['GET', '/posts/1'], ['GET', '/posts/by-external/b0c1d2e3-0000'], ['POST', '/posts'],
            ['PATCH', '/posts/1'], ['POST', '/media'], ['POST', '/posts/1/publish'], ['POST', '/test'],
            ['POST', '/posts/1/replace-original'], ['POST', '/posts/1/indexnow'],
        ];
    }

    public function test_ohne_schluessel_401_auf_jedem_endpunkt() {
        foreach ($this->alle_routen() as $r) {
            $this->neue_ip();
            $res = $this->req($r[0], $r[1], $r[0] === 'GET' ? null : [], false);
            $this->assertSame(401, $res->get_status(), $r[0] . ' ' . $r[1]);
            $this->assertSame('ezr_auth_missing', $this->code($res));
        }
    }

    public function test_falscher_schluessel_401_auf_jedem_endpunkt() {
        foreach ($this->alle_routen() as $r) {
            $this->neue_ip();
            $res = $this->req($r[0], $r[1], $r[0] === 'GET' ? null : [], 'ezr_' . str_repeat('0', 44));
            $this->assertSame(401, $res->get_status(), $r[0] . ' ' . $r[1]);
            $this->assertSame('ezr_auth_invalid', $this->code($res));
        }
    }

    public function test_schluessel_auch_ueber_x_ezyrank_key() {
        $r = new WP_REST_Request('GET', '/ezyrank/v1/health');
        $r->set_header('x-ezyrank-key', $this->key);
        $res = $this->server->dispatch($r);
        $this->assertSame(200, $res->get_status());
        $this->assertSame(EzyHub_Connector::VERSION, $res->get_data()['plugin_version']);
    }

    public function test_neuer_schluessel_macht_alten_ungueltig() {
        $alt = $this->key;
        $this->key = EzyRank_Auth::generate_key();
        $this->assertSame(401, $this->req('GET', '/health', null, $alt)->get_status());
        $this->assertSame(200, $this->req('GET', '/health')->get_status());
        $this->assertStringNotContainsString($this->key, (string) get_option('ezyrank_key_hash'));
    }

    public function test_nur_https() {
        unset($_SERVER['HTTPS']);
        $res = $this->req('GET', '/health');
        $this->assertSame(403, $res->get_status());
        $this->assertSame('ezr_https_required', $this->code($res));
    }

    public function test_rate_limit_nach_10_fehlversuchen() {
        for ($i = 0; $i < 10; $i++) $this->req('GET', '/health', null, 'ezr_' . str_repeat('1', 44));
        $res = $this->req('GET', '/health');
        $this->assertSame(429, $res->get_status());
        $this->assertSame('ezr_rate_limited', $this->code($res));
        $this->neue_ip();
        $this->assertSame(200, $this->req('GET', '/health')->get_status());
    }

    public function test_upsert_zweimal_ein_beitrag() {
        $a = $this->req('POST', '/posts', $this->artikel());
        $this->assertSame(200, $a->get_status(), wp_json_encode($a->get_data()));
        $this->assertTrue($a->get_data()['created']);
        $b = $this->req('POST', '/posts', $this->artikel(['title' => 'Neuer Titel']));
        $this->assertFalse($b->get_data()['created']);
        $this->assertSame($a->get_data()['post_id'], $b->get_data()['post_id']);
        $this->assertSame('Neuer Titel', get_the_title($b->get_data()['post_id']));
        $this->assertSame('trinkwasser-afrika-spenden', get_post($b->get_data()['post_id'])->post_name);
        $this->assertSame('draft', $b->get_data()['status']);
    }

    public function test_kommentare_und_pings_immer_geschlossen() {
        update_option('default_comment_status', 'open');
        update_option('default_ping_status', 'open');
        $a = $this->req('POST', '/posts', $this->artikel());
        $id = $a->get_data()['post_id'];
        $this->assertSame('closed', get_post($id)->comment_status);
        $this->assertSame('closed', get_post($id)->ping_status);
        wp_update_post(['ID' => $id, 'comment_status' => 'open', 'ping_status' => 'open']);
        $this->req('POST', '/posts', $this->artikel(['title' => 'Update']));
        $this->assertSame('closed', get_post($id)->comment_status);
        $this->assertSame('closed', get_post($id)->ping_status);
    }

    public function test_update_ohne_kategorie_laesst_kategorie_unveraendert() {
        $cat = self::factory()->category->create(['name' => 'Wasser']);
        $a = $this->req('POST', '/posts', $this->artikel(['category_ids' => [$cat], 'tags' => ['afrika']]));
        $id = $a->get_data()['post_id'];
        $this->req('POST', '/posts', $this->artikel(['title' => 'Ohne Kategorie im Update']));
        $this->assertSame([$cat], wp_get_post_categories($id));
        $this->assertSame(['afrika'], wp_get_post_tags($id, ['fields' => 'names']));
    }

    public function test_bild_aus_eigener_mediathek_ohne_neuen_upload() {
        $att = self::factory()->attachment->create_object([
            'file' => '2026/11/brunnen.jpg', 'post_mime_type' => 'image/jpeg', 'post_type' => 'attachment',
        ]);
        $vorher = count(get_posts(['post_type' => 'attachment', 'numberposts' => -1, 'post_status' => 'any']));
        $url = wp_upload_dir()['baseurl'] . '/2026/11/brunnen-800x600.jpg';
        $res = $this->req('POST', '/posts', $this->artikel([
            'external_id' => 'b0c1d2e3-0000-4000-8000-0000000000aa',
            'featured_image' => ['url' => $url, 'alt' => 'Brunnen im Dorf'],
        ]));
        $this->assertSame(200, $res->get_status(), wp_json_encode($res->get_data()));
        $this->assertSame($att, (int) get_post_thumbnail_id($res->get_data()['post_id']));
        $nachher = count(get_posts(['post_type' => 'attachment', 'numberposts' => -1, 'post_status' => 'any']));
        $this->assertSame($vorher, $nachher);
        $this->assertSame('Brunnen im Dorf', get_post_meta($att, '_wp_attachment_image_alt', true));
    }

    public function test_bild_eigene_website_ausserhalb_mediathek_abgelehnt() {
        $res = $this->req('POST', '/posts', $this->artikel([
            'featured_image' => ['url' => home_url('/wp-content/themes/x/logo.png'), 'alt' => 'x'],
        ]));
        $this->assertSame(422, $res->get_status());
    }

    public function test_bild_von_fremder_domain_wird_abgelehnt() {
        $res = $this->req('POST', '/posts', $this->artikel([
            'featured_image' => ['url' => 'https://example.com/bild.jpg', 'alt' => 'x'],
        ]));
        $this->assertSame(422, $res->get_status());
        $this->assertSame('ezr_image_failed', $this->code($res));
        $this->assertSame(0, EzyRank_Posts::find_by_external('b0c1d2e3-0000-4000-8000-000000000001'));
        $m = $this->req('POST', '/media', ['url' => 'http://' . EZYRANK_STORAGE_HOST . '/x.jpg']);
        $this->assertSame('ezr_image_failed', $this->code($m)); // nur https
    }

    public function test_publish_nur_mit_scope() {
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        $res = $this->req('POST', '/posts/' . $id . '/publish', []);
        $this->assertSame(403, $res->get_status());
        $this->assertSame('ezr_scope_missing', $this->code($res));
        $this->assertSame('draft', get_post_status($id));

        update_option('ezyrank_scope_publish', '1');
        $ok = $this->req('POST', '/posts/' . $id . '/publish', []);
        $this->assertSame(200, $ok->get_status());
        $this->assertSame('publish', get_post_status($id));
    }

    public function test_status_publish_ueber_posts_verboten() {
        update_option('ezyrank_scope_publish', '1');
        $res = $this->req('POST', '/posts', $this->artikel(['status' => 'publish']));
        $this->assertSame(403, $res->get_status());
    }

    public function test_live_beitrag_bleibt_live_beim_update() {
        update_option('ezyrank_scope_publish', '1');
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        $this->req('POST', '/posts/' . $id . '/publish', []);
        $this->req('POST', '/posts', $this->artikel(['title' => 'Korrektur']));
        $this->assertSame('publish', get_post_status($id));
        $this->assertSame('Korrektur', get_the_title($id));
    }

    public function test_publish_fremder_beitrag_verboten() {
        update_option('ezyrank_scope_publish', '1');
        $fremd = self::factory()->post->create(['post_status' => 'draft']);
        $this->assertSame(404, $this->req('POST', '/posts/' . $fremd . '/publish', [])->get_status());
        $this->assertSame(404, $this->req('PATCH', '/posts/' . $fremd, ['title' => 'x'])->get_status());
        $this->assertSame('draft', get_post_status($fremd));
    }

    public function test_html_wird_bereinigt() {
        $html = '<p onclick="alert(1)" style="color:red;text-align:center">Hallo</p>'
            . '<script>alert(2)</script><iframe src="https://evil.example/x"></iframe>'
            . '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>'
            . '<details><summary>Frage</summary><p>Antwort</p></details>';
        $id = $this->req('POST', '/posts', $this->artikel(['content_html' => $html]))->get_data()['post_id'];
        $c = get_post($id)->post_content;
        $this->assertStringNotContainsString('onclick', $c);
        $this->assertStringNotContainsString('<script', $c);
        $this->assertStringNotContainsString('alert(2)', $c);
        $this->assertStringNotContainsString('evil.example', $c);
        $this->assertStringNotContainsString('color', $c);
        $this->assertStringContainsString('text-align', $c);
        $this->assertStringContainsString('youtube-nocookie.com/embed/abc', $c);
        $this->assertStringContainsString('<details>', $c);
    }

    // Der CTA-Block kommt als Absätze mit Klasse: <div> und class auf <a> lässt der Filter nicht durch.
    public function test_cta_absaetze_behalten_ihre_klassen() {
        $html = '<p>Text</p>'
            . '<p class="ezyrank-cta ezyrank-cta-text">Jeder Beitrag hilft.</p>'
            . '<p class="ezyrank-cta ezyrank-cta-button"><a href="https://example.org/spenden/"><strong>Jetzt spenden</strong></a></p>';
        $id = $this->req('POST', '/posts', $this->artikel(['content_html' => $html]))->get_data()['post_id'];
        $c = get_post($id)->post_content;
        $this->assertStringContainsString('<p class="ezyrank-cta ezyrank-cta-text">Jeder Beitrag hilft.</p>', $c);
        $this->assertStringContainsString('<p class="ezyrank-cta ezyrank-cta-button"><a ', $c);
        $this->assertStringContainsString('href="https://example.org/spenden/"', $c);
        $this->assertStringContainsString('<strong>Jetzt spenden</strong>', $c);
    }

    public function test_yoast_felder() {
        add_filter('ezyrank_active_seo_plugins', function () { return ['yoast']; });
        $id = $this->req('POST', '/posts', $this->artikel(['seo' => [
            'title' => 'SEO Titel', 'description' => 'Beschreibung', 'focus_keyword' => 'trinkwasser afrika spenden',
        ]]))->get_data()['post_id'];
        $this->assertSame('SEO Titel', get_post_meta($id, '_yoast_wpseo_title', true));
        $this->assertSame('Beschreibung', get_post_meta($id, '_yoast_wpseo_metadesc', true));
        $this->assertSame('trinkwasser afrika spenden', get_post_meta($id, '_yoast_wpseo_focuskw', true));
    }

    public function test_rank_math_felder() {
        add_filter('ezyrank_active_seo_plugins', function () { return ['rankmath']; });
        $id = $this->req('POST', '/posts', $this->artikel(['seo' => [
            'title' => 'RM Titel', 'description' => 'RM Beschreibung', 'focus_keyword' => 'kw',
        ]]))->get_data()['post_id'];
        $this->assertSame('RM Titel', get_post_meta($id, 'rank_math_title', true));
        $this->assertSame('RM Beschreibung', get_post_meta($id, 'rank_math_description', true));
        $this->assertSame('kw', get_post_meta($id, 'rank_math_focus_keyword', true));
        $this->assertSame('', get_post_meta($id, '_yoast_wpseo_title', true));
    }

    public function test_verbindungstest_hinterlaesst_keinen_beitrag() {
        $vorher = (int) wp_count_posts('post')->draft;
        $res = $this->req('POST', '/test', []);
        $this->assertSame(200, $res->get_status());
        $this->assertTrue($res->get_data()['created_and_deleted']);
        $this->assertSame($vorher, (int) wp_count_posts('post')->draft);
    }

    public function test_capabilities_und_by_external() {
        $caps = $this->req('GET', '/capabilities')->get_data();
        $this->assertSame(['read', 'draft'], $caps['scopes']);
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        $d = $this->req('GET', '/posts/by-external/b0c1d2e3-0000-4000-8000-000000000001')->get_data();
        $this->assertSame($id, $d['post_id']);
    }

    public function test_publish_schliesst_kommentare_und_meldet_indexnow() {
        update_option('ezyrank_scope_publish', '1');
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        wp_update_post(['ID' => $id, 'comment_status' => 'open', 'ping_status' => 'open']);
        $d = $this->req('POST', '/posts/' . $id . '/publish', [])->get_data();
        $this->assertSame('closed', get_post($id)->comment_status);
        $this->assertSame('closed', get_post($id)->ping_status);
        $this->assertTrue($d['indexnow']['ok']);
        $this->assertCount(1, $this->pings);
        $this->assertSame([get_permalink($id)], $this->pings[0]['urlList']);
        $this->assertSame(EzyRank_Indexnow::key(), $this->pings[0]['key']);
        $this->assertSame(1, preg_match('/^[a-f0-9]{32}$/', $this->pings[0]['key']));
    }

    public function test_geplanter_beitrag_wird_noch_nicht_gemeldet() {
        update_option('ezyrank_scope_publish', '1');
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        $d = $this->req('POST', '/posts/' . $id . '/publish', ['date' => gmdate('c', time() + 86400)])->get_data();
        $this->assertSame('future', $d['status']);
        $this->assertArrayNotHasKey('indexnow', $d);
        $this->assertCount(0, $this->pings);
    }

    public function test_indexnow_route_nur_fuer_live_beitraege() {
        update_option('ezyrank_scope_publish', '1');
        $entwurf = self::factory()->post->create(['post_status' => 'draft']);
        $this->assertSame(400, $this->req('POST', '/posts/' . $entwurf . '/indexnow', [])->get_status());
        $live = self::factory()->post->create(['post_status' => 'publish']);
        $res = $this->req('POST', '/posts/' . $live . '/indexnow', []);
        $this->assertSame(200, $res->get_status());
        $this->assertTrue($res->get_data()['indexnow']['ok']);
        $this->assertCount(1, $this->pings);
    }

    public function test_indexnow_gesperrte_website_meldet_nichts() {
        update_option('blog_public', '0');
        $r = EzyRank_Indexnow::ping(home_url('/x/'));
        $this->assertFalse($r['ok']);
        $this->assertCount(0, $this->pings);
    }

    public function test_indexnow_schluesseldatei_pfad() {
        $k = str_repeat('a', 32);
        $this->assertTrue(EzyRank_Indexnow::is_key_request('/' . $k . '.txt', $k));
        $this->assertTrue(EzyRank_Indexnow::is_key_request('/blog/' . $k . '.txt?x=1', $k, '/blog/'));
        $this->assertFalse(EzyRank_Indexnow::is_key_request('/' . $k . '.txt', ''));
        $this->assertFalse(EzyRank_Indexnow::is_key_request('/wp-content/' . $k . '.txt', $k));
        $this->assertFalse(EzyRank_Indexnow::is_key_request('/' . str_repeat('b', 32) . '.txt', $k));
    }

    public function test_ersetzen_nur_mit_scope() {
        $orig = self::factory()->post->create(['post_status' => 'publish', 'post_content' => '<p>Alt</p>']);
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        $res = $this->req('POST', '/posts/' . $id . '/replace-original', ['original_url' => get_permalink($orig)]);
        $this->assertSame(403, $res->get_status());
        $this->assertSame('<p>Alt</p>', get_post($orig)->post_content);
    }

    public function test_ersetzen_uebernimmt_inhalt_und_behaelt_url() {
        update_option('ezyrank_scope_publish', '1');
        $cat = self::factory()->category->create(['name' => 'Nothilfe']);
        $orig = self::factory()->post->create([
            'post_status' => 'publish', 'post_title' => 'Alter Titel', 'post_name' => 'nothilfe-afrika',
            'post_content' => '<p>Alt</p>', 'post_category' => [$cat],
            'comment_status' => 'open', 'ping_status' => 'open',
        ]);
        $url = get_permalink($orig);
        $datum = get_post($orig)->post_date;
        $id = $this->req('POST', '/posts', $this->artikel([
            'title' => '[Überarbeitung] Nothilfe', 'slug' => 'nothilfe-afrika-ueberarbeitung',
            'content_html' => '<h2>Neu</h2><p>Besser</p>',
        ]))->get_data()['post_id'];

        $res = $this->req('POST', '/posts/' . $id . '/replace-original', ['original_url' => $url, 'title' => 'Nothilfe in Afrika']);
        $this->assertSame(200, $res->get_status(), wp_json_encode($res->get_data()));
        $d = $res->get_data();
        $this->assertSame($orig, $d['post_id']);
        $this->assertSame($id, $d['replaced_draft_id']);
        $this->assertSame('publish', $d['status']);
        $this->assertTrue($d['indexnow']['ok']);

        $p = get_post($orig);
        $this->assertStringContainsString('Besser', $p->post_content);
        $this->assertSame('Nothilfe in Afrika', $p->post_title);
        $this->assertSame('nothilfe-afrika', $p->post_name);
        $this->assertSame($datum, $p->post_date);
        $this->assertSame($url, get_permalink($orig));
        $this->assertSame([$cat], wp_get_post_categories($orig));
        $this->assertSame('closed', $p->comment_status);
        $this->assertSame('closed', $p->ping_status);
        $this->assertSame('trash', get_post_status($id));
        $this->assertSame($orig, EzyRank_Posts::find_by_external('b0c1d2e3-0000-4000-8000-000000000001'));
        $this->assertNotEmpty(wp_get_post_revisions($orig));
    }

    public function test_ersetzen_ohne_passendes_original() {
        update_option('ezyrank_scope_publish', '1');
        $id = $this->req('POST', '/posts', $this->artikel())->get_data()['post_id'];
        $seite = self::factory()->post->create(['post_type' => 'page', 'post_status' => 'publish']);
        $entwurf = self::factory()->post->create(['post_status' => 'draft']);
        foreach ([home_url('/?p=999999'), get_permalink($seite), get_permalink($entwurf), 'https://example.com/x', ''] as $url) {
            $this->neue_ip();
            $res = $this->req('POST', '/posts/' . $id . '/replace-original', ['original_url' => $url]);
            $this->assertSame(404, $res->get_status(), $url);
            $this->assertSame('ezr_original_not_found', $this->code($res));
        }
        $this->assertSame('draft', get_post_status($id));
        // Fremder Beitrag als «Überarbeitung» ist nicht erlaubt.
        $orig = self::factory()->post->create(['post_status' => 'publish']);
        $this->assertSame(404, $this->req('POST', '/posts/' . $entwurf . '/replace-original', ['original_url' => get_permalink($orig)])->get_status());
    }

    public function test_bestehende_ezyhub_routen_bleiben() {
        $routes = $this->server->get_routes();
        $this->assertArrayHasKey('/ezyhub/v1/status', $routes);
        $this->assertArrayHasKey('/ezyhub/v1/page-meta', $routes);
    }
}
