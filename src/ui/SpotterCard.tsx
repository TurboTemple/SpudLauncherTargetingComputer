/** Shooter side: invite a spotter by QR code, and take their marks back by scanning theirs. */

import { useState } from 'preact/hooks';
import { inviteLink, parseSpotterLink } from '../data/spotter';
import { importSpotterMarks } from '../state/actions';
import { launch, session, target, toast } from '../state/store';
import { Card } from './fields';
import { Qr } from './Qr';
import { QrScanner } from './QrScanner';

export const appBase = () => `${location.origin}${import.meta.env.BASE_URL}`;

export async function shareOrCopy(url: string, title: string): Promise<void> {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch {
    /* cancelled */
  }
}

export function SpotterCard() {
  const [invite, setInvite] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const l = launch.value;
  const s = session.value;

  const makeInvite = async () => {
    if (!l || !s) return;
    const t = target.value;
    setInvite(await inviteLink(appBase(), { s: s.id, l: [l.lat, l.lon], ...(t ? { t: [t.lat, t.lon] as [number, number] } : {}) }));
  };
  const onScan = async (text: string) => {
    setScanning(false);
    const r = await parseSpotterLink(text);
    if (r && 'marks' in r) await importSpotterMarks(r.marks);
    else toast("That QR code isn't a spotter's marks", 'warn');
  };

  return (
    <Card title="Spotter">
      <p class="small">
        A friend near the landing area can mark where each shot lands on their own phone. No account or server: you swap QR codes.
      </p>
      {!invite ? (
        <button class="btn" disabled={!l} onClick={() => void makeInvite()}>
          Invite a spotter
        </button>
      ) : (
        <div class="qr-box">
          <Qr text={invite} label="Spotter invite QR code" />
          <p class="small">The spotter scans this with their phone camera. It opens this app in spotter mode with your launch point and target.</p>
          <div class="row">
            <button class="btn btn-small" onClick={() => void shareOrCopy(invite, 'Spot for my potato cannon')}>
              Share link
            </button>
            <button class="btn btn-small" onClick={() => setInvite(null)}>
              Hide
            </button>
          </div>
        </div>
      )}
      {!l && <p class="muted small">Set the launch point first.</p>}
      <button class="btn btn-primary" onClick={() => setScanning(true)}>
        Scan spotter's marks
      </button>
      <p class="muted small">Shots must have been fired (tap Fire, or automatic detection) so their landings can be matched by time.</p>
      {scanning && <QrScanner onResult={(t) => void onScan(t)} onClose={() => setScanning(false)} />}
    </Card>
  );
}
