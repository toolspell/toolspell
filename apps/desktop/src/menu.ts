// Adapted from T3 Code's apps/desktop/src/window/DesktopApplicationMenu.ts (MIT).
import { app, Menu, type MenuItemConstructorOptions } from "electron";

/** Replaces Electron's default menu, whose Help points at Electron and whose Window menu has Ctrl+W. */
export const setApplicationMenu = () => {
  const mac = process.platform === "darwin";
  const developer: Array<MenuItemConstructorOptions> = app.isPackaged
    ? []
    : [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ];
  const appMenu: MenuItemConstructorOptions = mac
    ? {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      }
    : { label: "File", submenu: [{ role: "quit" }] };
  // Off macOS the last window closing quits the app, so nothing binds Ctrl+W to close.
  const windowItems: Array<MenuItemConstructorOptions> = mac
    ? [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
        { type: "separator" },
        { role: "front" },
      ]
    : [{ role: "minimize" }];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          ...developer,
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { label: "Window", submenu: windowItems },
    ]),
  );
};
