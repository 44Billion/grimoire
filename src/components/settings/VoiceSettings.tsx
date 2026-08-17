/**
 * Voice settings: which devices to capture with, and which broker to start a
 * call through.
 *
 * All of it is local. The devices are properties of this machine, and the broker
 * is only ever consulted for an EMPTY room — once anyone is in a call, their
 * announced broker wins the rendezvous (CORD-07 §5), because joining the call
 * where it already is matters more than any preference.
 */

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canonicalOrigin } from "@/lib/concord/voice";
import {
  DEFAULT_BROKER,
  preferredBroker,
  setPreferredBroker,
} from "@/services/concord-brokers";
import {
  listDevices,
  preferredCameraId,
  preferredMicId,
  chooseCaptureDevice,
} from "@/services/concord-devices-ui";

const SYSTEM = "__system__";

export function VoiceSettingsSection() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState(preferredMicId() ?? SYSTEM);
  const [camera, setCamera] = useState(preferredCameraId() ?? SYSTEM);
  const [broker, setBroker] = useState(preferredBroker() ?? "");
  const [brokerError, setBrokerError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void listDevices().then(({ mics, cameras }) => {
        if (cancelled) return;
        setMics(mics);
        setCameras(cameras);
      });
    load();
    // Plugging a headset in mid-session should show up without a reload.
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener("devicechange", load);
    };
  }, []);

  const saveBroker = () => {
    const trimmed = broker.trim();
    if (!trimmed) {
      setPreferredBroker(undefined);
      setBrokerError(undefined);
      return;
    }
    const canonical = canonicalOrigin(trimmed);
    if (!canonical) {
      // The grant is a bearer credential for its whole freshness window, so a
      // plaintext origin is refused rather than downgraded.
      setBrokerError("That is not an https origin.");
      return;
    }
    setPreferredBroker(canonical);
    setBroker(canonical);
    setBrokerError(undefined);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-medium">Devices</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Names appear once a call has been joined at least once — a browser
          hides them until it has been given permission.
        </p>
        <div className="space-y-3">
          <DevicePicker
            label="Microphone"
            devices={mics}
            value={mic}
            onChange={(id) => {
              setMic(id);
              void chooseCaptureDevice(
                "audioinput",
                id === SYSTEM ? undefined : id,
              );
            }}
          />
          <DevicePicker
            label="Camera"
            devices={cameras}
            value={camera}
            onChange={(id) => {
              setCamera(id);
              void chooseCaptureDevice(
                "videoinput",
                id === SYSTEM ? undefined : id,
              );
            }}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">Voice server</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          A blind broker that mints tokens for the media server. It is
          authorized by possession of the channel&apos;s key rather than by
          membership, so it cannot tell which community a room belongs to or who
          is joining, and it only ever forwards ciphertext. Used only to START a
          call in an empty channel; joining an existing one follows whoever is
          already in it. Leave empty for {DEFAULT_BROKER}.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            onBlur={saveBroker}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveBroker();
            }}
            placeholder={DEFAULT_BROKER}
            className="h-8 max-w-sm text-xs"
          />
          <Button size="sm" variant="outline" onClick={saveBroker}>
            Save
          </Button>
        </div>
        {brokerError && (
          <p className="mt-1 text-xs text-destructive">{brokerError}</p>
        )}
      </div>
    </div>
  );
}

function DevicePicker({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 max-w-sm text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SYSTEM}>System default</SelectItem>
          {devices.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${index + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
