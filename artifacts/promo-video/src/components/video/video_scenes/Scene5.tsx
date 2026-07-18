import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { MessageSquare, Hash, Send } from 'lucide-react';

const MESSAGE_TEXT = "Notice served at Unit 4B. Evidence synced.";

export function Scene5() {
  const [phase, setPhase] = useState(0);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // Typing starts
      setTimeout(() => setPhase(3), 4800), // Send message
      setTimeout(() => setPhase(4), 5800), // Slack popups appear
    ];
    const typeStart = setTimeout(() => {
      const interval = setInterval(() => {
        setChars(c => {
          if (c >= MESSAGE_TEXT.length) {
            clearInterval(interval);
            return c;
          }
          return c + 1;
        });
      }, 55);
      timers.push(interval as unknown as ReturnType<typeof setTimeout>);
    }, 2000);
    timers.push(typeStart);
    return () => timers.forEach(t => { clearTimeout(t); clearInterval(t as unknown as ReturnType<typeof setInterval>); });
  }, []);

  const getCursorPos = () => {
    if (phase < 2) return { x: '50vw', y: '60vh' };
    if (phase === 2) return { x: '35vw', y: '85vh' }; // In text box
    if (phase === 3) return { x: '75vw', y: '85vh' }; // On send button
    return { x: '90vw', y: '90vh' }; 
  };

  const messageText = MESSAGE_TEXT;
  const displayedText = MESSAGE_TEXT.slice(0, chars);

  return (
    <motion.div className="absolute inset-0 bg-background overflow-hidden" exit={{ opacity: 0 }}>
      <AppShell activePath="/comms">
        <div className="p-[3vw] max-w-[70vw] mx-auto space-y-[2vw]">
          <div>
            <h1 className="text-[2.5vw] font-display font-bold tracking-tight">Communications</h1>
            <p className="text-[1vw] text-muted-foreground">Team chat and tenant messaging.</p>
          </div>

          <div className="border border-border rounded-[0.5vw] bg-card h-[60vh] flex overflow-hidden">
            <div className="w-[20%] border-r border-border p-[1vw] space-y-[1vw]">
              <div className="text-[0.7vw] font-bold uppercase tracking-wider text-muted-foreground">Channels</div>
              <div className="bg-primary/10 text-primary px-[0.8vw] py-[0.5vw] rounded text-[0.9vw] font-medium flex items-center gap-[0.5vw]">
                <Hash className="w-[1vw] h-[1vw]" /> general
              </div>
              <div className="text-muted-foreground px-[0.8vw] py-[0.5vw] rounded text-[0.9vw] font-medium flex items-center gap-[0.5vw]">
                <Hash className="w-[1vw] h-[1vw]" /> maintenance
              </div>
            </div>
            <div className="flex-1 flex flex-col relative">
              <div className="border-b border-border p-[1vw] flex items-center gap-[0.5vw] font-bold text-[1vw]">
                <Hash className="w-[1.2vw] h-[1.2vw] text-muted-foreground" /> general
              </div>
              <div className="flex-1 p-[2vw] overflow-hidden flex flex-col justify-end gap-[1vw]">
                <div className="flex gap-[1vw]">
                  <div className="w-[2vw] h-[2vw] rounded-full bg-muted flex items-center justify-center text-[0.8vw] font-bold">JD</div>
                  <div>
                    <div className="flex gap-[0.5vw] items-baseline">
                      <span className="font-bold text-[0.9vw]">Jane Doe</span>
                      <span className="text-[0.7vw] text-muted-foreground">10:00 AM</span>
                    </div>
                    <div className="text-[0.9vw]">Morning team, any updates on Maple Court?</div>
                  </div>
                </div>
                
                {phase >= 3 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-[1vw]">
                    <div className="w-[2vw] h-[2vw] rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[0.8vw] font-bold">MD</div>
                    <div>
                      <div className="flex gap-[0.5vw] items-baseline">
                        <span className="font-bold text-[0.9vw]">Marcus Delgado</span>
                        <span className="text-[0.7vw] text-muted-foreground">Just now</span>
                      </div>
                      <div className="text-[0.9vw]">{messageText}</div>
                    </div>
                  </motion.div>
                )}
              </div>
              <div className="border-t border-border p-[1vw] flex gap-[1vw] items-center">
                <div className="flex-1 border border-border rounded p-[0.8vw] text-[0.9vw]">
                  {phase >= 3 ? "" : (phase >= 2 ? displayedText : <span className="text-muted-foreground">Message #general</span>)}
                  {phase === 2 && <span className="inline-block w-[2px] h-[1vw] bg-foreground ml-[2px] animate-pulse" />}
                </div>
                <div className="w-[2.5vw] h-[2.5vw] rounded bg-primary text-primary-foreground flex items-center justify-center">
                  <Send className="w-[1.2vw] h-[1.2vw]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppShell>

      {/* Integration popups */}
      {phase >= 4 && (
        <>
          <motion.div 
            className="absolute top-[15vh] right-[5vw] w-[18vw] bg-white text-black p-[1vw] rounded-[0.5vw] shadow-2xl border border-gray-200 z-40 flex items-start gap-[1vw]"
            initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring' }}
          >
            <div className="w-[2vw] h-[2vw] rounded bg-[#E01E5A] shrink-0" />
            <div>
              <div className="text-[0.8vw] font-bold text-gray-500 uppercase tracking-wider mb-[0.2vw]">Slack Notification</div>
              <div className="text-[0.9vw] font-bold leading-tight">#rentnotice-updates</div>
              <div className="text-[0.9vw] leading-snug mt-[0.5vw]">Marcus Delgado: {messageText}</div>
            </div>
          </motion.div>

          <motion.div 
            className="absolute top-[30vh] right-[2vw] w-[18vw] bg-white text-black p-[1vw] rounded-[0.5vw] shadow-2xl border border-gray-200 z-40 flex items-start gap-[1vw]"
            initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', delay: 0.2 }}
          >
            <div className="w-[2vw] h-[2vw] rounded bg-[#0F9D58] shrink-0" />
            <div>
              <div className="text-[0.8vw] font-bold text-gray-500 uppercase tracking-wider mb-[0.2vw]">Google Chat</div>
              <div className="text-[0.9vw] font-bold leading-tight">Property Management</div>
              <div className="text-[0.9vw] leading-snug mt-[0.5vw]">Marcus Delgado: {messageText}</div>
            </div>
          </motion.div>
        </>
      )}

      <Cursor x={getCursorPos().x} y={getCursorPos().y} clicking={phase === 3} />
      <Kicker text="Central comms hub — syncs seamlessly with Slack & Google Chat" />
    </motion.div>
  );
}