import { MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { WindowInstance } from "@/types/app";
import { WindowToolbar } from "./WindowToolbar";
import { WindowRenderer } from "./WindowRenderer";

interface WindowTileProps {
  id: string;
  window: WindowInstance;
  path: MosaicBranch[];
  onClose: (id: string) => void;
}

export function WindowTile({ id, window, path, onClose }: WindowTileProps) {
  return (
    <MosaicWindow
      path={path}
      title={window.title}
      toolbarControls={<WindowToolbar onClose={() => onClose(id)} />}
    >
      <WindowRenderer window={window} onClose={() => onClose(id)} />
    </MosaicWindow>
  );
}
