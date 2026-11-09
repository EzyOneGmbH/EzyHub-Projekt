<?php
/**
 * PHPUnit (WP-Testsuite) für die EzyRank-Schnittstelle, Bauanleitung Kap. 10.
 */

class Test_EzyRank_Api extends WP_UnitTestCase {
    /** @var WP_REST_Server */
    private $server;
    private $key;
    private $ip = 0;

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

    public function test_update_ohne_kategorie_laesst_kategorie_unveraendert() {
        $cat = self::factory()->category->create(['name' => 'Wasser']);
        $a = $this->req('POST', '/posts', $this->artikel(['category_ids' => [$cat], 'tags' => ['afrika']]));
        $id = $a->get_data()['post_id'];
        $this->req('POST', '/posts', $this->artikel(['title' => 'Ohne Kategorie im Update']));
        $this->assertSame([$cat], wp_get_post_categories($id));
        $this->assertSame(['afrika'], wp_get_post_tags($id, ['fields' => 'names']));
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

    public function test_bestehende_ezyhub_routen_bleiben() {
        $routes = $this->server->get_routes();
        $this->assertArrayHasKey('/ezyhub/v1/status', $routes);
        $this->assertArrayHasKey('/ezyhub/v1/page-meta', $routes);
    }
}
