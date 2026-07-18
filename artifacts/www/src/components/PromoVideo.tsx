export default function PromoVideo() {
  return (
    <div className="relative w-full max-w-6xl mx-auto aspect-video pointer-events-none select-none">
      <video
        src={`${import.meta.env.BASE_URL}media/promo.mp4`}
        className="w-full h-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        controls={false}
        tabIndex={-1}
        aria-hidden="true"
      />
      {/* Edge feathering into the page background so the video reads as part of the page, not a framed object */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-background to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
        <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-background to-transparent" />
        <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-background to-transparent" />
      </div>
    </div>
  );
}
