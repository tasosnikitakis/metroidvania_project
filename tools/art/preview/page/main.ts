// Real-Phaser check of RigView: a row of heroes each looping one animation, plus one
// "player" that cycles through animations with cross-fades. ?t=<seconds> fast-forwards (for screenshots).
import Phaser from 'phaser';
import rigJson from '../../../../content/rigs/hero.rig.json';
import type { RigData } from '../../../../src/shared/types';
import { HERO_ANIMS } from '../../../../src/shared/types';
import { RigView, preloadRig } from '../../../../src/rig/index';

const rig = rigJson as unknown as RigData;
const params = new URLSearchParams(location.search);
const ZOOM = 2;

class Preview extends Phaser.Scene {
  views: RigView[] = [];
  player!: RigView;
  cycle = 0; timer = 0; log: string[] = [];
  preload() { preloadRig(this, rig); this.load.image('tiles', 'assets/tiles/tileset.png'); }
  create() {
    this.cameras.main.setBackgroundColor('#2b2263');
    this.cameras.main.setZoom(ZOOM); this.cameras.main.centerOn(320, 180);
    this.add.rectangle(320, 150 + 100, 640, 200, 0x55548f);
    this.add.rectangle(320, 330 + 100, 640, 200, 0x55548f);
    HERO_ANIMS.forEach((name, i) => {
      const v = new RigView(this, rig);
      v.setPosition(40 + i * 62, 150); v.play(name);
      if (i % 2) v.setFacing(-1);
      this.views.push(v);
      this.add.text(40 + i * 62, 156, name, { fontSize: '9px', color: '#fff' }).setOrigin(0.5, 0).setResolution(3);
    });
    this.player = new RigView(this, rig);
    this.player.setPosition(320, 330); this.player.play('idle');
    this.player.onEvent((ev, anim) => { this.log.push(`${anim}:${ev}`); (window as any).__events = this.log; });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      const i = '1234567890'.indexOf(e.key);
      if (i >= 0) this.player.play(HERO_ANIMS[i], { restart: true });
      if (e.key === 'f') this.player.setFacing(this.player.root.scaleX > 0 ? -1 : 1);
    });
    this.input.on('pointerdown', () => this.player.play('attack', { restart: true }));
    const ff = Number(params.get('t') ?? 0);
    for (let t = 0; t < ff; t += 1 / 60) this.step(1 / 60);
    (window as any).__ready = true;
    (window as any).__view = this.player;
  }
  step(dt: number) {
    // non-looping demo animations restart themselves
    this.views.forEach((v) => { if (v.finished && (v.currentTime > rig.animations[v.current].duration + 0.4)) v.play(v.current, { restart: true }); v.update(dt); });
    this.timer += dt;
    if (params.get('cycle') !== '0' && this.timer > 0.55) { this.timer = 0; this.cycle = (this.cycle + 1) % HERO_ANIMS.length; this.player.play(HERO_ANIMS[this.cycle]); }
    this.player.update(dt);
  }
  update(_t: number, dtMs: number) { if (!params.get('freeze')) this.step(dtMs / 1000); }
}

new Phaser.Game({ type: Phaser.AUTO, width: 1280, height: 720, parent: document.body, scene: Preview, backgroundColor: '#120f33', render: params.get('mt') ? { maxTextures: Number(params.get('mt')) } : {} });
