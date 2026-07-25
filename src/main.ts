import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

new Game(canvas, uiRoot);
