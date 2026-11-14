# HomeQuest

[Česky](README.cs.md)

A game for children in Home Assistant: children do their daily chores (brush teeth, tidy the room, …), earn gold coins for them,
buy gear for their hero and build a fortress together. A parent sets up and approves the chores in the Home Assistant app.

## What you need
- Home Assistant 2026.11 or newer (the **Marketplace** is built in; the integration itself runs from 2026.8.0).
- A Home Assistant account for each child (without administrator rights): **Settings** → **People** → **Add person**, turn on **Allow person to login**.
- The Home Assistant app for playing on a phone and for notifications.
- The game is in Czech for now.

## Installation
1. **Settings** → **Marketplace** → in the upper-right corner **Add from link** → enter `https://github.com/eloupak/homequest-dist` under **GitHub link** → **Add**.
   The first time you add a repository, the **Marketplace** asks you to connect a GitHub account (you enter a code on GitHub and approve).
   It detects the integration type by itself.
2. Find HomeQuest, install it and restart Home Assistant.
3. **Settings** → **Devices & services** → **Add integration** → HomeQuest.
4. Open HomeQuest in the sidebar and go through the setup wizard: children, their accounts, parents, your area, notifications. Then start the game.

The whole game runs in your home and needs no internet after the installation. The children's data stays in your Home Assistant.

## Updates
Home Assistant offers a new version under **Settings** → **Updates** (and HomeQuest shows it to parents on the parent screen); restart
Home Assistant after the update. An update does not change the game in progress or your settings.

Want to try new versions early? **Settings** → **Devices & services** → **Marketplace** → the HomeQuest device: the **Pre-release** entity is disabled
by default; enable it first, then turn the switch on. Beta versions may contain bugs. Make a Home Assistant backup before updating;
to go back to an earlier version after an update, restore the backup instead of installing an older version.

## License
HomeQuest (code and art) is licensed under [CC BY-NC-ND 4.0](LICENSE): you may install and use it for free for private purposes.
You may not modify it, share modified versions or use it commercially. The fonts Alegreya SC and Nunito are under the SIL Open Font
License (`LICENSE-fonts/`).
