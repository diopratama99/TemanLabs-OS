import { moveIfOldPort, pickUpSettings } from './lib/movePort'

// Settings brought from the server's old port go back first: the desktop reads them as it loads.
// Opened at an old port, the page moves on to the new one while the desktop loads.
void pickUpSettings().then(() => {
  void import('./boot')
  void moveIfOldPort()
})
