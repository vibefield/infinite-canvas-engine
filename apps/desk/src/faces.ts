// The desk's HAND (design-015 §6.1; D2c): the three OFL faces the app ships (assets/fonts, OFL.txt
// beside them — Caveat medium and semibold, Kalam) handed to the desk's text raster by URL. The desk
// names the faces and their weights (`PEN_FACES`); the app owns the files. One raster per page: the
// faces load once, lazily, the first time a note asks for one. The same three faces BAKED (petition I59 —
// the desk's pen: assets/hand, `ice-hand/1` atlases from the kit's baker) are the page's hand faces, lent
// to every kind under the same names and fetched the first time a sheet asks for one.

import { handFaces, type HandFacesLender, inkRaster, type InkRaster, penFaces } from "@ice/desk";
import caveat500 from "../assets/fonts/Caveat-500.ttf?url";
import caveat600 from "../assets/fonts/Caveat-600.ttf?url";
import kalam400 from "../assets/fonts/Kalam-400.ttf?url";
import caveat500Bin from "../assets/hand/caveat-500.hand.bin?url";
import caveat500Json from "../assets/hand/caveat-500.hand.json?url";
import caveat600Bin from "../assets/hand/caveat-600.hand.bin?url";
import caveat600Json from "../assets/hand/caveat-600.hand.json?url";
import kalam400Bin from "../assets/hand/kalam-400.hand.bin?url";
import kalam400Json from "../assets/hand/kalam-400.hand.json?url";

let raster: InkRaster | null = null;
let hand: HandFacesLender | null = null;

/** The page's text raster over the app's faces. */
export function deskText(): InkRaster {
  raster ??= inkRaster({ faces: penFaces({ caveat: caveat500, "caveat-bold": caveat600, kalam: kalam400 }) });
  return raster;
}

/** The page's hand faces (petition I59): the baked atlases by the `PEN_FACES` names, each fetched once, on a sheet's first ask. */
export function deskHand(): HandFacesLender {
  hand ??= handFaces({
    faces: {
      caveat: { json: caveat500Json, bin: caveat500Bin },
      "caveat-bold": { json: caveat600Json, bin: caveat600Bin },
      kalam: { json: kalam400Json, bin: kalam400Bin },
    },
  });
  return hand;
}
