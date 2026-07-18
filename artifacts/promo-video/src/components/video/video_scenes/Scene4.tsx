import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Smartphone, MapPin, Camera, Navigation } from 'lucide-react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500), // Mobile shows
      setTimeout(() => setPhase(3), 2500), // Photo taken
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0F1729]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-[5vw] overflow-hidden rounded-[1vw] shadow-2xl border border-white/10">
        <AppShell activePath="/field">
          <div className="p-[3vw] h-full flex justify-between relative z-20">
            <div className="w-[40%]">
              <h1 className="text-[2.5vw] font-display font-bold text-foreground mb-[1vw]">Field Service App</h1>
              <p className="text-[1.2vw] text-muted-foreground mb-[2vw]">Dispatch process servers. Capture undeniable proof.</p>
              
              <div className="space-y-[1vw]">
                {['GPS Verified', 'Offline Support', 'Timestamped Photos'].map((f, i) => (
                  <motion.div 
                    key={f}
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.1 }}
                    className="flex items-center gap-[1vw] bg-card p-[1vw] rounded-[0.5vw] border border-border"
                  >
                    <div className="w-[2vw] h-[2vw] bg-primary/20 rounded text-primary flex items-center justify-center">
                      <MapPin className="w-[1vw] h-[1vw]" />
                    </div>
                    <span className="font-bold text-[1vw]">{f}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            {phase >= 2 && (
              <motion.div 
                initial={{ y: '100vh' }} animate={{ y: 0 }} transition={{ type: 'spring', damping: 20 }}
                className="w-[22vw] h-[45vw] bg-black border-[0.8vw] border-gray-800 rounded-[3vw] absolute bottom-[-5vw] right-[10vw] flex flex-col overflow-hidden shadow-2xl z-30"
              >
                <div className="bg-gray-900 p-[1.5vw] pt-[2vw] border-b border-gray-800 text-white">
                  <div className="text-[1vw] font-bold text-center">RentNotice Field</div>
                </div>
                <div className="flex-1 p-[1.5vw] flex flex-col gap-[1vw] bg-gray-950 text-white">
                  <div className="bg-gray-800 p-[1vw] rounded-[0.5vw]">
                    <div className="text-[0.8vw] text-gray-400">ASSIGNMENT</div>
                    <div className="font-bold text-[1.2vw]">Unit 4B</div>
                  </div>
                  
                  <div className="flex-1 bg-black border border-gray-800 rounded-[0.5vw] flex flex-col items-center justify-center relative overflow-hidden">
                    {phase >= 3 ? (
                      <>
                        <div className="absolute inset-0 bg-primary/20" />
                        <Camera className="w-[3vw] h-[3vw] text-primary" />
                        <div className="absolute bottom-0 inset-x-0 bg-black/60 p-[0.5vw] text-[0.6vw] text-center text-primary font-mono">
                          34.0522° N, -118.2437° W
                        </div>
                      </>
                    ) : (
                      <Camera className="w-[3vw] h-[3vw] text-gray-600" />
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </AppShell>
      </div>
      <Kicker text="Mobile companion app for field crews with GPS proof" />
    </motion.div>
  );
}
