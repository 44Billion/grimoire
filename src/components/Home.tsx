import { useState, useEffect } from "react";
import UserMenu from "./nostr/user-menu";
import { useGrimoire } from "@/core/state";
import { useAccountSync } from "@/hooks/useAccountSync";
import Feed from "./nostr/Feed";
import { WinViewer } from "./WinViewer";
import { WindowToolbar } from "./WindowToolbar";
import { TabBar } from "./TabBar";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { NipRenderer } from "./NipRenderer";
import ManPage from "./ManPage";
import CommandLauncher from "./CommandLauncher";
import ReqViewer from "./ReqViewer";
import { EventDetailViewer } from "./EventDetailViewer";
import { ProfileViewer } from "./ProfileViewer";
import EncodeViewer from "./EncodeViewer";
import DecodeViewer from "./DecodeViewer";
import KindRenderer from "./KindRenderer";
import { Terminal } from "lucide-react";
import { Button } from "./ui/button";

export default function Home() {
  const { state, activeWorkspace, updateLayout, removeWindow } = useGrimoire();
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);

  // Sync active account and fetch relay lists
  useAccountSync();

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandLauncherOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleRemoveWindow = (id: string) => {
    // Remove from windows map
    removeWindow(id);
  };

  const renderTile = (id: string, path: MosaicBranch[]) => {
    const window = state.windows[id];

    if (!window) {
      return (
        <MosaicWindow
          path={path}
          title="Unknown Window"
          toolbarControls={<WindowToolbar />}
        >
          <div className="p-4 text-muted-foreground">
            Window not found: {id}
          </div>
        </MosaicWindow>
      );
    }

    // Render based on appId
    let content;
    switch (window.appId) {
      case "nip":
        content = <NipRenderer nipId={window.props.number} />;
        break;
      case "feed":
        content = <Feed className="h-full w-full overflow-auto" />;
        break;
      case "win":
        content = <WinViewer />;
        break;
      case "kind":
        content = <KindRenderer kind={parseInt(window.props.number)} />;
        break;
      case "man":
        content = <ManPage cmd={window.props.cmd} />;
        break;
      case "req":
        content = (
          <ReqViewer
            filter={window.props.filter}
            relays={window.props.relays}
            closeOnEose={window.props.closeOnEose}
            nip05Authors={window.props.nip05Authors}
            nip05PTags={window.props.nip05PTags}
          />
        );
        break;
      case "open":
        content = <EventDetailViewer pointer={window.props.pointer} />;
        break;
      case "profile":
        content = <ProfileViewer pubkey={window.props.pubkey} />;
        break;
      case "encode":
        content = <EncodeViewer args={window.props.args} />;
        break;
      case "decode":
        content = <DecodeViewer args={window.props.args} />;
        break;
      default:
        content = (
          <div className="p-4 text-muted-foreground">
            Unknown app: {window.appId}
          </div>
        );
    }

    return (
      <MosaicWindow
        path={path}
        title={window.title}
        toolbarControls={
          <WindowToolbar onClose={() => handleRemoveWindow(id)} />
        }
      >
        <div className="h-full w-full overflow-auto">{content}</div>
      </MosaicWindow>
    );
  };

  return (
    <>
      <CommandLauncher
        open={commandLauncherOpen}
        onOpenChange={setCommandLauncherOpen}
      />

      <main className="h-screen w-screen flex flex-col bg-background text-foreground">
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1 text-muted-foreground hover:text-accent transition-colors cursor-pointer"
            title="Launch command (Cmd+K)"
          >
            <Terminal className="size-4" />
          </button>
          <UserMenu />
        </header>
        <section className="flex-1 relative overflow-hidden">
          {activeWorkspace.layout === null ? (
            <div className="h-full w-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-8">
                <pre className="font-mono text-xs leading-tight text-grimoire-gradient">
                  {`                    ★                                             ✦
                                                       :          ☽
                                                      t#,                           ,;
    ✦     .Gt j.         t                           ;##W.   t   j.               f#i
         j#W: EW,        Ej            ..       :   :#L:WE   Ej  EW,            .E#t
   ☆   ;K#f   E##j       E#,          ,W,     .Et  .KG  ,#D  E#, E##j          i#W,
     .G#D.    E###D.     E#t         t##,    ,W#t  EE    ;#f E#t E###D.       L#D.  ✦
    j#K;      E#jG#W;    E#t        L###,   j###t f#.     t#iE#t E#jG#W;    :K#Wfff;
  ,K#f   ,GD; E#t t##f   E#t      .E#j##,  G#fE#t :#G     GK E#t E#t t##f   i##WLLLLt
☽  j#Wi   E#t E#t  :K#E: E#t     ;WW; ##,:K#i E#t  ;#L   LW. E#t E#t  :K#E:  .E#L
    .G#D: E#t E#KDDDD###iE#t    j#E.  ##f#W,  E#t   t#f f#:  E#t E#KDDDD###i   f#E: ★
      ,K#fK#t E#f,t#Wi,,,E#t  .D#L    ###K:   E#t    f#D#;   E#t E#f,t#Wi,,,    ,WW;
   ✦    j###t E#t  ;#W:  E#t :K#t     ##D.    E#t     G#t    E#t E#t  ;#W:       .D#;
         .G#t DWi   ,KK: E#t ...      #G      ..       t     E#t DWi   ,KK:        tt
           ;;      ☆     ,;.          j              ✦       ,;.                ☆     `}
                </pre>

                <div className="flex flex-col items-center gap-3">
                  <p className="text-muted-foreground text-sm font-mono mb-2">
                    Press{" "}
                    <kbd className="px-2 py-1 bg-muted border border-border text-xs">
                      Cmd+K
                    </kbd>{" "}
                    or
                  </p>
                  <Button
                    onClick={() => setCommandLauncherOpen(true)}
                    variant="outline"
                  >
                    <span>⌘</span>
                    <span>Launch Command</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Mosaic
              renderTile={renderTile}
              value={activeWorkspace.layout}
              onChange={updateLayout}
              onRelease={(node) => {
                // When Mosaic removes a node from the layout, clean up the window
                if (typeof node === "string") {
                  handleRemoveWindow(node);
                }
              }}
              className="mosaic-blueprint-theme"
            />
          )}
        </section>
        <TabBar />
      </main>
    </>
  );
}
