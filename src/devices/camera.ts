import { AxiosResponse } from 'axios';
import { interval, Subject } from 'rxjs';
import { TuyaCameraPlatform } from '../platform';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { device, payload } from '../settings';

export class TuyaCamera {

  // Characteristic Values
  Active!: CharacteristicValue;
  SetupEndpoints!: CharacteristicValue;
  StreamingStatus!: CharacteristicValue;
  SupportedRTPConfiguration!: CharacteristicValue;
  SelectedRTPStreamConfiguration!: CharacteristicValue;
  SupportedVideoStreamConfiguration!: CharacteristicValue;
  SupportedAudioStreamConfiguration!: CharacteristicValue;

  // OpenAPI Others
  deviceStatus;

  // Config
  private readonly deviceDebug = this.platform.config.options?.debug === 'device' || this.platform.debugMode;
  private readonly debugDebug = this.platform.config.options?.debug === 'debug' || this.platform.debugMode;

  // Updates
  cameraUpdateInProgress!: boolean;
  doCameraUpdate!: Subject<void>;

  constructor(
    private readonly platform: TuyaCameraPlatform,
    private accessory: PlatformAccessory,
    public device: device,
  ) {

    // this is subject we use to track when we need to POST changes to the SwitchBot API
    this.doCameraUpdate = new Subject();
    this.cameraUpdateInProgress = false;

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'SwitchBot')
      .setCharacteristic(this.platform.Characteristic.Model, device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.id);

    // Start an update interval
    interval(this.platform.config!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.cameraUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });
  }


  private async refreshStatus() {
    try {
      this.platform.log.info(this.device.name);
      this.platform.getCameraHLS(this.device.id);
      this.platform.getCameraRSTP(this.device.id);
    } catch (e: any) {
      this.platform.log.error(`Tuya Camera: ${this.accessory.displayName} failed refreshStatus with TuyaOpenAPI Connection`);
      if (this.deviceDebug) {
        this.platform.log.error(`Tuya Camera: ${this.accessory.displayName} failed refreshStatus with TuyaOpenAPI Connection,`
          + ` Error Message: ${JSON.stringify(e.message)}`);
      }
      if (this.debugDebug) {
        this.platform.log.error(`Tuya Camera: ${this.accessory.displayName} failed refreshStatus with TuyaOpenAPI Connection,`
          + ` Error: ${JSON.stringify(e)}`);
      }
    }
  }
}