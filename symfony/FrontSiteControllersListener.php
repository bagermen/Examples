<?php
namespace Petrosoft\LoyaltyBundle\EventListener;

use Net\Gearman\Exception;
use Petrosoft\LoyaltyBundle\Controller\Api\Front\NeedAuthControllerInterface;
use Petrosoft\MeetzBundle\Doctrine\DBAL\AccountConnection;
use Symfony\Component\HttpKernel\Event\FilterControllerEvent;
use Petrosoft\MeetzBundle\Service\Factory as Meetz;
use Petrosoft\LoyaltyBundle\Services\DbLoyaltyBasedOAuth2;
use \Symfony\Component\HttpFoundation\HeaderBag;

/**
 * Class FrontSiteControllersListener
 * @package Petrosoft\LoyaltyBundle\Listener
 */
class FrontSiteControllersListener
{
    protected $meetz;
    protected $oAuth;

    /**
     * @param Meetz                $meetz
     * @param DbLoyaltyBasedOAuth2 $oAuth
     */
    public function __construct(Meetz $meetz, DbLoyaltyBasedOAuth2 $oAuth)
    {
        $this->meetz = $meetz;
        $this->oAuth = $oAuth;
    }

    /**
     * @param FilterControllerEvent $event
     */
    public function onKernelController(FilterControllerEvent $event)
    {
        $controller = $event->getController();

        /*
         * $controller passed can be either a class or a Closure.
         * This is not usual in Symfony but it may happen.
         * If it is a class, it comes in array format
         */
        if (!is_array($controller)) {
            return;
        }

        if ($controller[0] instanceof NeedAuthControllerInterface) {
            $programId = null;

            if ($event->getRequest()->headers->has('Authorization') && $this->oAuth->isTokenValid()) {
                /** @var \Petrosoft\UserBundle\Lib\OAuth2tokens $token */
                $token = $loyaltyId = $this->oAuth->getToken();
                $user = $this->oAuth->getQSUser();
                $loyaltyPrograms = $user->getData('loyalty');
                foreach ($loyaltyPrograms as $loyaltyData) {
                    if (array_key_exists('loyalty_program_id', $loyaltyData)) {
                        $programId = $loyaltyData['loyalty_program_id'];
                    }
                    if ($programId instanceof \MongoId) {
                        $programId = $programId->{'$id'};
                    }

                    if (array_key_exists('loyalty_id', $loyaltyData)) {
                        if ($loyaltyData['loyalty_id'] == $token->getClientId()) {
                            break;
                        }
                    }
                    $programId = null;
                }
            } else {
                $programId = $event->getRequest()->query->get('program_id');
            }

            if (!$programId) {
                $programId = $this->getProgramByOrigin($event->getRequest()->headers);
                if ($programId) {
                    $event->getRequest()->query->set('program_id', $programId);
                }
            }

            if ($programId) {
                $this->switchConnectionByProgram($programId);
            }
        }
    }

    protected function switchConnectionByProgram($programId)
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyProgram\Collection $programCol */
        $programCol = $this->meetz->collection('Loyalty:Models\LoyaltyProgram');
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyProgram $program */
        $program = $programCol->findById($programId);

        if (!$program->isObjectNew()) {
            $accountId = $program->getAccountId();

            if ($accountId) {
                /** @var AccountConnection $con */
                $con = $this->meetz->getConnectionManager()->getConnection('account');
                $con->setAccountId($accountId);
                $con->close();
                $con->connect();
            }
        }
    }

    protected function getProgramByOrigin(HeaderBag $headers)
    {
        $program = null;
        if ($headers->has('Origin')) {
            $host = parse_url($headers->get('Origin'), PHP_URL_HOST);
            /** @var \Petrosoft\LoyaltyBundle\Models\FrontSiteSettings\Collection $siteCol */
            $siteCol = $this->meetz->collection('Loyalty:Models\FrontSiteSettings');
            $siteCol->addFieldToFilter('hosts', array($host), 'in');
            $siteSettings = $siteCol->getFirstItem();

            if (!$siteSettings->isObjectNew()) {
                $program = $siteSettings->getData('loyalty_program_id');

                if ($program instanceof \MongoId) {
                    $program = $program->{'$id'};
                }
            }
        }

        return $program;
    }
}
