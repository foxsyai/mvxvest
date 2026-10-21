import { RouteNamesEnum } from 'localConstants';
import { Account } from 'pages/Account';
import { Create } from 'pages/Create';
import { Created } from 'pages/Created';
import { Guide } from 'pages/Guide';
import { Home } from 'pages/Home';
import { KeyPage } from 'pages/Key';
import { Mine } from 'pages/Mine';
import { Token } from 'pages/Token';
import { VestingPage } from 'pages/Vesting';
import { RouteType } from 'types';

interface RouteWithTitleType extends RouteType {
  title: string;
}

// Every page can be opened without a wallet; the ones about "my" vestings ask
// to connect when needed.
export const routes: RouteWithTitleType[] = [
  { path: RouteNamesEnum.home, title: 'mvxvest', component: Home },
  { path: RouteNamesEnum.create, title: 'Create vestings', component: Create },
  { path: RouteNamesEnum.mine, title: 'My vestings', component: Mine },
  { path: RouteNamesEnum.created, title: 'Created by me', component: Created },
  { path: RouteNamesEnum.vesting, title: 'Vesting', component: VestingPage },
  { path: RouteNamesEnum.token, title: 'Token', component: Token },
  { path: RouteNamesEnum.account, title: 'Address', component: Account },
  { path: RouteNamesEnum.key, title: 'Key', component: KeyPage },
  { path: RouteNamesEnum.guide, title: 'How it works', component: Guide }
];
