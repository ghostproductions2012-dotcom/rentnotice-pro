import { useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

export default function PromoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted(!muted);
    }
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto aspect-video group">
      <video
        ref={videoRef}
        src={`${import.meta.env.BASE_URL}media/promo.mp4`}
        className="w-full h-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      >
        <p>
          Your browser doesn't support HTML video. Here is a{" "}
          <a href={`${import.meta.env.BASE_URL}media/promo.mp4`}>link to the video</a> instead.
        </p>
      </video>

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute bottom-4 right-4 flex items-center justify-center w-10 h-10 rounded-full bg-background/60 backdrop-blur-sm text-foreground/80 hover:text-foreground hover:bg-background/80 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
      >
        {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>
    </div>
  );
}
