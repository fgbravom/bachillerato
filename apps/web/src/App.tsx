import type { ReactNode } from 'react';
import { GameEndScreen, GameScreen, HomeScreen, LobbyScreen, type SoundControl } from './ui';
import { useSoundMuted } from './sound';
import { actions } from './state/client';
import {
  GameToast,
  LeaveConfirmNotice,
  ResumingScreen,
  TakenOverNotice,
  UpdateNotice,
} from './state/Notices';
import { useGameStore } from './state/store';

/** Elige la pantalla según el estado de la sala (PLAN.md sección 2: LOBBY → LETTER → WRITING → REVIEW → ROUND_END → GAME_END). */
export function App() {
  const status = useGameStore((s) => s.status);
  const takenOver = useGameStore((s) => s.takenOver);
  const resuming = useGameStore((s) => s.resuming);
  const busy = useGameStore((s) => s.busy);
  const nickname = useGameStore((s) => s.nickname);
  const inviteCode = useGameStore((s) => s.inviteCode);
  const homeError = useGameStore((s) => s.homeError);
  const roomError = useGameStore((s) => s.roomError);
  const newVersion = useGameStore((s) => s.newVersion);
  const updateDismissed = useGameStore((s) => s.updateDismissed);
  const confirmingLeave = useGameStore((s) => s.confirmingLeave);
  const onlineCount = useGameStore((s) => s.onlineCount);
  const { room, feed, serverOffsetMs } = useGameStore((s) => s.session);

  const [muted, toggleMuted] = useSoundMuted();
  const sound: SoundControl = { muted, onToggle: toggleMuted };

  // Mientras se abre el primer socket no se asusta con un aviso de conexión.
  const connected = status !== 'disconnected' && !takenOver;

  let screen: ReactNode;
  if (!room) {
    screen = resuming ? (
      <ResumingScreen onCancel={actions.cancelResume} />
    ) : (
      <HomeScreen
        initialName={nickname}
        inviteCode={inviteCode}
        error={homeError}
        onDismissError={actions.dismissHomeError}
        busy={busy}
        connected={connected}
        onlineCount={onlineCount}
        onCreateRoom={actions.createRoom}
        onJoinRoom={actions.joinRoom}
        onNameChange={actions.setNickname}
      />
    );
  } else if (room.phase === 'LOBBY') {
    screen = (
      <LobbyScreen
        room={room}
        feed={feed}
        connected={connected}
        sound={sound}
        error={roomError}
        onDismissError={actions.dismissRoomError}
        onChangeSettings={actions.changeSettings}
        onStart={actions.startGame}
        onSendMessage={actions.sendMessage}
        onLeave={actions.requestLeave}
      />
    );
  } else if (room.phase === 'GAME_END') {
    screen = (
      <GameEndScreen
        ranking={room.ranking ?? []}
        selfId={room.selfId}
        hostId={room.hostId}
        connected={connected}
        sound={sound}
        feed={feed}
        onSendMessage={actions.sendMessage}
        // "Jugar de nuevo" es `game:start`: el servidor devuelve la sala a la sala de espera.
        onPlayAgain={actions.startGame}
        onLeave={actions.requestLeave}
      />
    );
  } else {
    screen = (
      <>
        <GameScreen
          room={room}
          feed={feed}
          connected={connected}
          serverOffsetMs={serverOffsetMs}
          sound={sound}
          onStopLetter={actions.stopLetter}
          onAnswerChange={actions.changeAnswer}
          onStop={actions.stop}
          onVote={actions.vote}
          onReady={actions.ready}
          onSendMessage={actions.sendMessage}
          onLeave={actions.requestLeave}
        />
        <GameToast error={roomError} onDismiss={actions.dismissRoomError} />
      </>
    );
  }

  return (
    <>
      {screen}
      {room && newVersion !== null && !updateDismissed && (
        <UpdateNotice onUpdate={actions.reloadForUpdate} onDismiss={actions.dismissUpdate} />
      )}
      {room && confirmingLeave && !takenOver && (
        <LeaveConfirmNotice onConfirm={actions.confirmLeave} onCancel={actions.cancelLeave} />
      )}
      {takenOver && <TakenOverNotice onResume={actions.resumeHere} />}
    </>
  );
}
