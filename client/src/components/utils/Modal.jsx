import React, {Fragment, useEffect} from 'react'

function Modal({children, popupOpen, additionalClasses = "", handleClose}) {

  useEffect(() => {
    // register onKeyUp event to close modal on ESC key press
    const handleKeyUp = (e) => {
      if (e.key === 'Escape') {
        handleClose && typeof handleClose === 'function' && handleClose();
      }
    }

    if(popupOpen)
      window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keyup', handleKeyUp);
    }
  });

  if (!popupOpen)
    return "";

  return <Fragment>
    <div
      className={`w-screen h-screen backdrop-blur-sm fixed top-0 right-0 flex justify-center items-center ${handleClose ? 'cursor-pointer' : ''}`}
      style={{
        zIndex: 99
      }}
      onClick={(e) => {
        if(e.target !== e.currentTarget) return

        return handleClose && typeof handleClose === 'function' && handleClose()
      }}
    >
      <div className={`rounded-md shadow-md cursor-default ${additionalClasses}`}>
        {children}
      </div>
    </div>
  </Fragment>
}

export default Modal
