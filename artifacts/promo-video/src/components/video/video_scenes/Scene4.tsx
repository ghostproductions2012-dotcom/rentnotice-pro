import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Camera, MapPin, UploadCloud, KeyRound, CheckCircle } from 'lucide-react';

const ACCESS_CODE = ['7', '4', '2', '9', '1', '6'];

export function Scene4() {
  const [phase, setPhase] = useState(0);
  const [digits, setDigits] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // Cursor clicks push to field
      setTimeout(() => setPhase(3), 3500), // Phone appears — access code sign-in
      setTimeout(() => setPhase(4), 8200), // Signed in — assignment view
      setTimeout(() => setPhase(5), 10800), // Phone snaps photo
      setTimeout(() => setPhase(6), 13200), // Sync back to desktop
    ];
    const digitTimers = ACCESS_CODE.map((_, i) =>
      setTimeout(() => setDigits(i + 1), 5200 + i * 420)
    );
    return () => [...timers, ...digitTimers].forEach(t => clearTimeout(t));
  }, []);

  const getCursorPos = () => {
    if (phase < 2) return { x: '50vw', y: '60vh' };
    if (phase >= 2 && phase < 3) return { x: '45vw', y: '15vh' }; // Over Push to Field
    return { x: '90vw', y: '90vh' }; // Move away
  };

  return (
    <motion.div className="absolute inset-0 bg-background overflow-hidden" exit={{ opacity: 0 }}>
      <AppShell activePath="/field">
        <div className="p-[3vw] max-w-[65vw] mx-auto space-y-[2vw]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[2.5vw] font-display font-bold tracking-tight">Field Assignments</h1>
              <p className="text-[1vw] text-muted-foreground">Dispatch notices to process servers.</p>
            </div>
            <div className={`px-[1.5vw] py-[0.7vw] rounded-[0.5vw] text-[1vw] font-medium flex items-center gap-[0.5vw] shadow-sm transition-colors ${phase >= 2 ? 'bg-muted text-muted-foreground' : 'border border-border bg-card'}`}>
              <UploadCloud className="w-[1vw] h-[1vw]" /> Push to field
            </div>
          </div>

          <div className="border border-border rounded-[0.5vw] bg-card p-[1.5vw]">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-[0.5vw]">
                  <span className={`text-[0.7vw] font-bold px-[0.5vw] py-[0.2vw] rounded uppercase ${phase >= 6 ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground'}`}>
                    {phase >= 6 ? 'Completed' : 'In Progress'}
                  </span>
                  <span className="font-bold text-[1.1vw]">Maria Alvarez</span>
                  <span className="border border-border text-[0.8vw] px-[0.4vw] rounded text-muted-foreground">3-Day Notice</span>
                </div>
                <div className="text-[0.9vw] text-muted-foreground mt-[0.5vw]">Maple Court, #4B</div>
                <div className="text-[0.9vw] mt-[0.5vw]"><span className="text-muted-foreground">Server:</span> Marcus Delgado</div>
              </div>
              <div className="text-right">
                {phase >= 6 && (
                  <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-end gap-[0.5vw]">
                    <div className="bg-muted px-[1vw] py-[0.5vw] rounded flex items-center gap-[0.5vw] text-[0.9vw]">
                      <Camera className="w-[1vw] h-[1vw]" /> Evidence (1)
                    </div>
                    <div className="text-[0.8vw] font-mono text-muted-foreground flex items-center gap-[0.3vw]">
                      <MapPin className="w-[0.8vw] h-[0.8vw]" /> 34.0522° N, -118.2437° W
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppShell>

      {/* Mobile App Overlay */}
      {phase >= 3 && (
        <motion.div 
          className="absolute right-[10vw] top-[10vh] w-[20vw] h-[40vw] border-[0.5vw] border-slate-800 rounded-[2.5vw] bg-slate-900 shadow-2xl overflow-hidden z-40"
          initial={{ y: '100vh', rotate: 10 }}
          animate={{ y: 0, rotate: -5 }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        >
          <div className="absolute top-[1vw] left-1/2 -translate-x-1/2 w-[6vw] h-[1.5vw] bg-black rounded-full z-20" />
          <div className="p-[1.5vw] pt-[4vw] h-full flex flex-col gap-[1vw] text-white">
            <div className="text-[1.2vw] font-bold border-b border-slate-700 pb-[1vw]">RentNotice Field</div>

            {phase < 4 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-[1.5vw]">
                <div className="w-[4vw] h-[4vw] rounded-full bg-slate-800 flex items-center justify-center">
                  <KeyRound className="w-[2vw] h-[2vw] text-primary" />
                </div>
                <div className="text-center">
                  <div className="text-[1.1vw] font-bold">Enter access code</div>
                  <div className="text-[0.8vw] text-slate-400 mt-[0.3vw]">No password needed — ask your office</div>
                </div>
                <div className="flex gap-[0.5vw]">
                  {ACCESS_CODE.map((d, i) => (
                    <div key={i} className={`w-[2vw] h-[2.6vw] rounded-[0.4vw] border flex items-center justify-center text-[1.3vw] font-mono font-bold transition-colors ${i < digits ? 'border-primary bg-slate-800 text-white' : 'border-slate-700 bg-slate-800/50 text-slate-600'}`}>
                      {i < digits ? d : ''}
                    </div>
                  ))}
                </div>
                {digits >= ACCESS_CODE.length && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[0.9vw] text-green-400 font-medium flex items-center gap-[0.4vw]">
                    <CheckCircle className="w-[1vw] h-[1vw]" /> Verified — signing in
                  </motion.div>
                )}
              </div>
            ) : (
              <>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800 p-[1vw] rounded-[1vw]">
                  <div className="text-[0.8vw] text-slate-400">ASSIGNMENT</div>
                  <div className="text-[1.2vw] font-bold">Maple Court, #4B</div>
                  <div className="text-[1vw]">Maria Alvarez</div>
                </motion.div>

                {phase >= 5 ? (
                  <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative flex-1 bg-black rounded-[1vw] overflow-hidden flex items-center justify-center border border-slate-700">
                    <div className="absolute inset-0 bg-primary/20" />
                    <Camera className="w-[3vw] h-[3vw] text-primary z-10" />
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 p-[1vw] text-[0.7vw] font-mono text-primary backdrop-blur-sm">
                      GPS: 34.0522° N, -118.2437° W<br/>
                      Time: 14:32:05 PST
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex-1 border-2 border-dashed border-slate-700 rounded-[1vw] flex flex-col items-center justify-center gap-[1vw]">
                    <Camera className="w-[3vw] h-[3vw] text-slate-500" />
                    <div className="text-[1vw] text-slate-400">Tap to capture</div>
                  </div>
                )}

                {phase >= 6 && (
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-green-600 p-[1vw] rounded-[1vw] text-center font-bold text-[1vw] flex items-center justify-center gap-[0.5vw]">
                    <CheckCircle className="w-[1.2vw] h-[1.2vw]" /> Synced to Office
                  </motion.div>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}

      <Cursor x={getCursorPos().x} y={getCursorPos().y} clicking={phase === 2} />
      <Kicker text="Field app — access-code sign-in, GPS evidence synced instantly" />
    </motion.div>
  );
}