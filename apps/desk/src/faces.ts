// The desk's HAND (design-015 §6.1; D2c): the three OFL faces the app ships (assets/fonts, OFL.txt
// beside them — Caveat medium and semibold, Kalam) handed to the desk's text raster by URL. The desk
// names the faces and their weights (`PEN_FACES`); the app owns the files. One raster per page: the
// faces load once, lazily, the first time a note asks for one.

import { inkRaster, type InkRaster, penFaces } from "@ice/desk";
import caveat500 from "../assets/fonts/Caveat-500.ttf?url";
import caveat600 from "../assets/fonts/Caveat-600.ttf?url";
import kalam400 from "../assets/fonts/Kalam-400.ttf?url";

let raster: InkRaster | null = null;

/** The page's text raster over the app's faces. */
export function deskText(): InkRaster {
  raster ??= inkRaster({ faces: penFaces({ caveat: caveat500, "caveat-bold": caveat600, kalam: kalam400 }) });
  return raster;
}
