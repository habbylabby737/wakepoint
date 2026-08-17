import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { WakepointGame, type Hud, type Mode } from "@/game/engine";
import { cn } from "@/lib/utils";

const EMPTY: Hud = {
  mode: "title",
  score: 0,
  lives: 3,
  wave: 0,
  waveBanner: "",
  power: { multi: 0, shield: 0, speed: 0 },
  highScores: [],
  lastScore: 0,
  lastWave: 0,
  isNewHigh: false,
  muted: false,
  ready: false,
};

export function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<WakepointGame | null>(null);
  const [hud, setHud] = useState<Hud>(EMPTY);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [returnTo, setReturnTo] = useState<Mode>("title");
  const { user, isPending } = useCurrentUserState();

  useEffect(() => {
    if (user?.displayName && !name) setName(user.displayName.slice(0, 16));
  }, [user, name]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new WakepointGame(canvas);
    game.onHud = setHud;
    gameRef.current = game;
    void game.boot();
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && !e.repeat) gameRef.current?.toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const start = () => {
    setSaved(false);
    gameRef.current?.startRun();
  };
  const setMode = (m: Mode) => gameRef.current?.setMode(m);
  const openOverlay = (m: Mode) => {
    if (hud.mode !== "scores" && hud.mode !== "help") setReturnTo(hud.mode);
    setMode(m);
  };
  const closeOverlay = () => setMode(returnTo);
  const saveScore = () => {
    if (saved) return;
    gameRef.current?.submitName(name || user?.displayName || "Pilot");
    setSaved(true);
  };

  const playing = hud.mode === "playing";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ touchAction: "none" }}
      />

      {playing && (
        <HudChrome
          hud={hud}
          onPause={() => setMode("paused")}
          onMute={() => gameRef.current?.toggleMute()}
        />
      )}

      {hud.mode === "playing" && hud.waveBanner && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] text-center">
          <p className="font-display text-4xl font-semibold tracking-[0.28em] text-fg/90 sm:text-5xl">
            {hud.waveBanner}
          </p>
        </div>
      )}

      {(hud.mode === "paused" || hud.mode === "gameover") && (
        <div className="pointer-events-none absolute inset-0 bg-bg/40" />
      )}

      {hud.mode === "title" && (
        <TitleScreen
          ready={hud.ready}
          muted={hud.muted}
          isPending={isPending}
          onPlay={start}
          onScores={() => openOverlay("scores")}
          onHelp={() => openOverlay("help")}
          onMute={() => gameRef.current?.toggleMute()}
        />
      )}

      {hud.mode === "paused" && (
        <Panel title="Paused" kicker="Hold formation">
          <Button className="w-full" onClick={() => setMode("playing")}>
            Resume
          </Button>
          <Button variant="outline" className="w-full" onClick={() => openOverlay("help")}>
            Controls
          </Button>
          <Button variant="outline" className="w-full" onClick={() => openOverlay("scores")}>
            High scores
          </Button>
          <Button variant="ghost" className="w-full" onClick={start}>
            Restart
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setMode("title")}>
            Flight deck
          </Button>
          <MuteRow muted={hud.muted} onClick={() => gameRef.current?.toggleMute()} />
        </Panel>
      )}

      {hud.mode === "gameover" && (
        <Panel title="Signal lost" kicker={`Wave ${String(hud.lastWave).padStart(2, "0")}`}>
          <p className="font-mono text-3xl tabular-nums">{hud.lastScore.toLocaleString()}</p>
          {hud.isNewHigh && !saved && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveScore();
              }}
            >
              <label className="text-xs font-medium tracking-wide text-muted uppercase">
                Board name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 16))}
                  className="mt-2 h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm text-fg outline-none focus:border-border-strong"
                  placeholder="Pilot"
                  autoComplete="nickname"
                />
              </label>
              <Button type="submit" className="w-full">
                Save score
              </Button>
            </form>
          )}
          {saved && <p className="text-sm text-ok">Logged to the board.</p>}
          <Button className="w-full" onClick={start}>
            Launch again
          </Button>
          <Button variant="outline" className="w-full" onClick={() => openOverlay("scores")}>
            High scores
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setMode("title")}>
            Flight deck
          </Button>
        </Panel>
      )}

      {hud.mode === "scores" && (
        <Panel title="High scores" kicker="Local board">
          <ScoreTable scores={hud.highScores} />
          <Button className="w-full" onClick={closeOverlay}>
            Back
          </Button>
        </Panel>
      )}

      {hud.mode === "help" && (
        <Panel title="Controls" kicker="Twin stick">
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            <li>
              <span className="text-fg">WASD / arrows</span> — move
            </li>
            <li>
              <span className="text-fg">Mouse / pointer</span> — aim
            </li>
            <li>
              <span className="text-fg">Click, hold, or Space</span> — fire
            </li>
            <li>
              <span className="text-fg">Hold pointer</span> — fly toward aim if no keys
            </li>
            <li>
              <span className="text-fg">Left stick (touch)</span> — move · right side fire
            </li>
            <li>
              <span className="text-fg">Esc / P</span> — pause · <span className="text-fg">M</span> — mute
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-muted">
            Pickups: tri-shot, shield, burn speed, extra life. Three lives. Waves escalate.
          </p>
          <Button className="w-full" onClick={closeOverlay}>
            Back
          </Button>
        </Panel>
      )}

      {playing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 hidden justify-center text-[11px] tracking-wide text-subtle uppercase sm:flex">
          WASD move · aim with pointer · hold to fire
        </div>
      )}
    </div>
  );
}

function TitleScreen({
  ready,
  muted,
  isPending,
  onPlay,
  onScores,
  onHelp,
  onMute,
}: {
  ready: boolean;
  muted: boolean;
  isPending: boolean;
  onPlay: () => void;
  onScores: () => void;
  onHelp: () => void;
  onMute: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col justify-between px-5 py-6 sm:px-10 sm:py-8">
      <header className="flex items-center justify-between gap-3">
        <p className="font-display text-[11px] font-semibold tracking-[0.32em] text-muted uppercase">
          Orbit defense
        </p>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onMute} className="grid size-11 place-items-center text-muted" aria-label="Mute">
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          {isPending ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-elevated" />
          ) : (
            <>
              <SignedOut>
                <Link to="/login" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
                  Sign in
                </Link>
              </SignedOut>
              <SignedIn>
                <div className="text-fg [&_button]:text-muted">
                  <UserButton />
                </div>
              </SignedIn>
            </>
          )}
        </div>
      </header>

      <div className="max-w-xl pt-8 sm:pt-4">
        <h1 className="font-display text-[clamp(3.2rem,12vw,6.4rem)] leading-[0.88] font-semibold tracking-[-0.04em]">
          Wake
          <br />
          point
        </h1>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted sm:text-base">
          Hold the orbit. Cut through enemy waves. Multi-shot, shield, and burn speed are out there.
        </p>
        <div className="mt-8 flex max-w-xs flex-col gap-3">
          <Button size="lg" className="w-full" onClick={onPlay} disabled={!ready}>
            <Play className="size-4" />
            {ready ? "Launch" : "Calibrating"}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={onScores}>
              Scores
            </Button>
            <Button variant="outline" onClick={onHelp}>
              Controls
            </Button>
          </div>
        </div>
      </div>

      <p className="text-[11px] tracking-wide text-subtle uppercase">Lives · waves · local high scores</p>
    </div>
  );
}

function HudChrome({ hud, onPause, onMute }: { hud: Hud; onPause: () => void; onMute: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-2xl font-medium tabular-nums sm:text-3xl">{hud.score.toLocaleString()}</p>
          <p className="mt-1 text-[11px] tracking-[0.18em] text-muted uppercase">
            Wave {String(hud.wave).padStart(2, "0")}
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-1">
          <button type="button" onClick={onMute} className="grid size-11 place-items-center text-muted" aria-label="Mute">
            {hud.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button type="button" onClick={onPause} className="grid size-11 place-items-center text-fg" aria-label="Pause">
            <Pause className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-label={`${hud.lives} lives`}>
          {Array.from({ length: Math.max(hud.lives, 0) }).map((_, i) => (
            <span key={i} className="block h-2 w-2 rotate-45 bg-fg" />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <PowerChip label="Tri" active={hud.power.multi > 0} value={hud.power.multi} />
          <PowerChip label="Shield" active={hud.power.shield > 0} value={hud.power.shield} />
          <PowerChip label="Burn" active={hud.power.speed > 0} value={hud.power.speed} />
        </div>
      </div>
    </div>
  );
}

function PowerChip({ label, active, value }: { label: string; active: boolean; value: number }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-2 py-1 font-mono text-[10px] tracking-wide tabular-nums uppercase",
        active ? "border-border-strong text-fg" : "border-border text-subtle",
      )}
    >
      {label}
      {active ? ` ${Math.ceil(value)}s` : ""}
    </span>
  );
}

function Panel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center px-4 py-8">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-7">
        <p className="text-[11px] font-medium tracking-[0.24em] text-muted uppercase">{kicker}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">{title}</h2>
        <div className="mt-6 flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

function ScoreTable({ scores }: { scores: Hud["highScores"] }) {
  if (!scores.length) {
    return <p className="text-sm text-muted">No signals logged yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {scores.map((s, i) => (
        <li key={`${s.at}-${s.score}`} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-subtle tabular-nums">{String(i + 1).padStart(2, "0")}</span>
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          <span className="font-mono tabular-nums">{s.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

function MuteRow({ muted, onClick }: { muted: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-11 items-center justify-center gap-2 text-sm text-muted">
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      {muted ? "Audio off" : "Audio on"}
    </button>
  );
}
