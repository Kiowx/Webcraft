# Minecraft Java 1.12.2 audio assets

The OGG files in this directory were downloaded from Mojang's official asset CDN using the hashes in `1.12.2-assets.json`. SHA-1 values were verified after download. These remain Minecraft/Mojang audio assets.

## Music

- title menu: 4 tracks
- survival overworld: 12 tracks
- creative overworld: 6 tracks
- Nether: 4 tracks
- End ambience: 1 track

## Sound effects

`sfx/` contains 315 original variants covering 167 WebCraft semantic events. `sfx-map.json` records each WebCraft event, the corresponding Minecraft 1.12.2 sound event, and its files. This includes the original `ui.button.click` (`random/click.ogg`), chests, blocks, footsteps, mobs, player damage, pickups, doors, buttons, bows, explosions, TNT, water, fire and cave ambience.

Long music and world sound variants are loaded lazily on first use. Menu clicks and chest sounds are decoded eagerly.
