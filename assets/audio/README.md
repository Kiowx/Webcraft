# Bundled audio assets

- `ui/` and `block/chest/` are WebCraft-generated fallback PCM WAV samples.
- `minecraft/music/` contains original Minecraft Java 1.12.2 music.
- `minecraft/sfx/` contains original Minecraft Java 1.12.2 sound effects, including the menu button click.

All original assets were fetched from Mojang's official asset CDN and verified against `minecraft/1.12.2-assets.json`. See `minecraft/README.md` and `minecraft/sfx-map.json`.

`js/audio.js` decodes menu-critical samples eagerly, while long music and world effects are fetched and decoded lazily on first use. Procedural audio remains the fallback for semantic events without a direct 1.12.2 equivalent.
