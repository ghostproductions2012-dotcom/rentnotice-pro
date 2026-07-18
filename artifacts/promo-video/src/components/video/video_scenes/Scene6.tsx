import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { MessageSquare, Slack, CheckCircle, Wrench } from 'lucide-react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500), // Message appears
      setTimeout(() => setPhase(3), 2500), // Integrations appear
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0F1729]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-[5vw] overflow-hidden rounded-[1vw] shadow-2xl border border-white/10">
        <AppShell activePath="/comms">
          <div className="p-[3vw] pr-[13vw] h-full relative z-20 flex">
            <div className="flex-1 space-y-[2vw]">
              <div>
                <h1 className="text-[2.5vw] font-display font-bold text-foreground">Communications Hub</h1>
                <p className="text-[1.2vw] text-muted-foreground">Team messaging & work order alerts</p>
              </div>

              <div className="bg-card border border-border rounded-[1vw] p-[2vw] max-w-[30vw] shadow-lg">
                <div className="flex gap-[1vw] items-start">
                  <div className="w-[2.5vw] h-[2.5vw] rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Wrench className="w-[1.2vw] h-[1.2vw]" />
                  </div>
                  <div>
                    <div className="font-bold text-[1.1vw]">Work Order #1042 Updated</div>
                    <div className="text-[0.9vw] text-muted-foreground mt-[0.5vw]">Status changed to Completed by Field Team.</div>
                  </div>
                </div>
              </div>

              {phase >= 2 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-card border border-border rounded-[1vw] p-[2vw] max-w-[30vw] shadow-lg ml-[2vw]"
                >
                  <div className="flex gap-[1vw] items-start">
                    <div className="w-[2.5vw] h-[2.5vw] rounded-full bg-primary flex items-center justify-center shrink-0 text-primary-foreground">
                      <MessageSquare className="w-[1.2vw] h-[1.2vw]" />
                    </div>
                    <div>
                      <div className="font-bold text-[1.1vw]">Notice Served</div>
                      <div className="text-[0.9vw] text-muted-foreground mt-[0.5vw]">Unit 4B notice posted successfully.</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="w-[25vw] relative flex flex-col justify-center gap-[2vw]">
              {phase >= 3 && (
                <>
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    className="bg-[#3b82f6]/10 border border-[#3b82f6]/30 p-[1.5vw] rounded-[1vw] text-center"
                  >
                    <div className="font-bold text-[1.2vw] text-[#3b82f6] mb-[0.5vw]">Slack Webhook</div>
                    <div className="text-[0.8vw] text-foreground/80">Real-time team updates</div>
                  </motion.div>
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
                    className="bg-[#10b981]/10 border border-[#10b981]/30 p-[1.5vw] rounded-[1vw] text-center"
                  >
                    <div className="font-bold text-[1.2vw] text-[#10b981] mb-[0.5vw]">Google Chat</div>
                    <div className="text-[0.8vw] text-foreground/80">Instant notifications</div>
                  </motion.div>
                </>
              )}
            </div>
          </div>
        </AppShell>
      </div>
      <Kicker text="Central comms hub with Slack & Google Chat sync" />
    </motion.div>
  );
}
