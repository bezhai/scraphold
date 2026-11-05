/** Browser entry: mounts the app. */
import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app') as HTMLElement);
