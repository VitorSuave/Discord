// =====================================================================
// useVoiceConnection.ts — Hook de conexão de voz/vídeo/tela via SFU (LiveKit)
// =====================================================================
// Responsabilidades:
// - Buscar o token de acesso no backend (que já validou RBAC — ver
//   permissions.ts) e conectar ao SFU.
// - Expor controles: mutar mic, deafen, câmera, compartilhar tela.
// - Manter lista de participantes remotos e seus estados de mídia
//   sincronizada para a UI renderizar (ícones de mute, avatar falando, etc).
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  ConnectionState,
  Track,
  TrackPublication // <- Adicione este aqui
} from "livekit-client";

interface VoiceConnectionState {
  connected: boolean;
  connecting: boolean;
  participants: RemoteParticipant[];
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  error: string | null;
}

interface VoiceTokenResponse {
  token: string;
  url: string;
}

export function useVoiceConnection(channelId: string) {
  const roomRef = useRef<Room | null>(null);

  const [state, setState] = useState<VoiceConnectionState>({
    connected: false,
    connecting: false,
    participants: [],
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    error: null,
  });

const patch = (partial: Partial<VoiceConnectionState>) =>
    setState((prev: VoiceConnectionState) => ({ ...prev, ...partial }));

  const refreshParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    patch({ participants: Array.from(room.remoteParticipants.values()) });
  }, []);

  // -------------------------------------------------------------------
  // Entrar no canal de voz
  // -------------------------------------------------------------------
  const join = useCallback(async () => {
    if (roomRef.current) return; // já conectado / conectando

    patch({ connecting: true, error: null });

    try {
      // O backend valida a permissão CONNECT via RBAC antes de emitir o token
      const res = await fetch(`/api/channels/${channelId}/voice-token`, {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Sem permissão para entrar neste canal");
      }

      const { token, url }: VoiceTokenResponse = await res.json();

      const room = new Room({
        adaptiveStream: true, // reduz qualidade de tracks fora de tela
        dynacast: true,       // SFU só transcodifica o necessário
      });

      room
        .on(RoomEvent.ParticipantConnected, refreshParticipants)
        .on(RoomEvent.ParticipantDisconnected, refreshParticipants)
        .on(RoomEvent.TrackMuted, refreshParticipants)
        .on(RoomEvent.TrackUnmuted, refreshParticipants)
        .on(RoomEvent.ConnectionStateChanged, (connState: ConnectionState) => {
          if (connState === ConnectionState.Disconnected) {
            patch({ connected: false });
          }
        })
        .on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          patch({
            connected: false,
            isMuted: false,
            isDeafened: false,
            isCameraOn: false,
            isScreenSharing: false,
            participants: [],
          });
        });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      roomRef.current = room;
      patch({ connected: true, connecting: false, isMuted: false });
      refreshParticipants();
    } catch (err) {
      patch({
        connecting: false,
        error: err instanceof Error ? err.message : "Falha ao conectar",
      });
    }
  }, [channelId, refreshParticipants]);

  // -------------------------------------------------------------------
  // Sair do canal de voz
  // -------------------------------------------------------------------
  const leave = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  // -------------------------------------------------------------------
  // Mutar / desmutar microfone
  // -------------------------------------------------------------------
  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const nextMuted = !state.isMuted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    patch({ isMuted: nextMuted });
  }, [state.isMuted]);

  // -------------------------------------------------------------------
  // Deafen (surdo) — silencia todo áudio recebido; ao ativar, também
  // muta o próprio microfone (mesmo comportamento do Discord)
  // -------------------------------------------------------------------
  const toggleDeafen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const nextDeafened = !state.isDeafened;

    

    room.remoteParticipants.forEach((participant: RemoteParticipant) => {
      participant.audioTrackPublications.forEach((publication: TrackPublication) => {
        const el = publication.track?.attachedElements[0] as
          | HTMLMediaElement
          | undefined;
        if (el) el.muted = nextDeafened;
      });
    });

    if (nextDeafened && !state.isMuted) {
      await room.localParticipant.setMicrophoneEnabled(false);
      patch({ isMuted: true });
    }

    patch({ isDeafened: nextDeafened });
  }, [state.isDeafened, state.isMuted]);

  // -------------------------------------------------------------------
  // Ligar / desligar câmera
  // -------------------------------------------------------------------
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const nextOn = !state.isCameraOn;
    await room.localParticipant.setCameraEnabled(nextOn);
    patch({ isCameraOn: nextOn });
  }, [state.isCameraOn]);

  // -------------------------------------------------------------------
  // Compartilhar tela (ou janela específica — o browser abre o seletor nativo)
  // -------------------------------------------------------------------
  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const nextSharing = !state.isScreenSharing;
      await room.localParticipant.setScreenShareEnabled(nextSharing, {
        audio: true, // captura áudio do sistema/aba quando suportado
      });
      patch({ isScreenSharing: nextSharing });
    } catch (err) {
      // Usuário cancelou o seletor nativo, ou permissão negada pelo SO
      patch({ error: "Compartilhamento de tela cancelado ou negado" });
    }
  }, [state.isScreenSharing]);

  // Garante desconexão ao desmontar o componente
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  return {
    ...state,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
  };
}
