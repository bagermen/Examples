<?php
namespace Petrosoft\LoyaltyBundle\Command;

use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Petrosoft\MeetzBundle\Service\Factory as MeetzFactory;
use Meetz\Mongodb\Collection as MongoCollection;
use Petrosoft\MeetzBundle\Meetz\Model;
use Petrosoft\LoyaltyBundle\Models\LoyaltyProgram;
use Petrosoft\LoyaltyBundle\Models\LoyaltyNumber;
use Petrosoft\LoyaltyBundle\Models\LoyaltyRange;
use Petrosoft\LoyaltyBundle\Models\LFSPromotion;
use Petrosoft\LoyaltyBundle\Models\LFSBanner;

/**
 * Class FixProgramsCommand
 * @package Petrosoft\LoyaltyBundle\Command
 */
class FixProgramsCommand extends Command
{
    const COMMAND_NAME = 'loyalty:fix:programs';
    const TYPE = 'test';
    const SHORT_TYPE = 't';

    /** @var OutputInterface */
    protected $output;
    protected $rotatePointer = 0;
    protected $pageSize = 30;
    protected $testMode = false;

    /** @var MeetzFactory */
    private $meetz;

    /**
     * @param MeetzFactory $meetz
     */
    public function __construct(MeetzFactory $meetz)
    {
        parent::__construct();

        $this->meetz = $meetz;
    }

    protected function configure()
    {
        parent::configure();

        $this->setName(self::COMMAND_NAME)
            ->addOption(self::TYPE, self::SHORT_TYPE, InputOption::VALUE_NONE, 'test mode')
            ->setDescription("Fix Loyalty Programs")
            ->setHelp(
                <<<EOF
                <info>loyalty:fix:programs</info>.

Simple usage:
    loyalty:fix:programs
EOF
            );

    }

    protected function execute(InputInterface $input, OutputInterface $output)
    {
        $output->writeln("<info>BEGIN</info>");
        $this->output = $output;
        $this->testMode = $input->getOption(self::TYPE);

        $this->writeLn("Update Indexes");
        $this->ensureIndexes();
        $this->writeLn("Update Programs");
        $this->forEachProgram($this->getProgramsCollection());
        $this->writeLn("Update Promotions");
        $this->forEachPromo($this->getLFSPromotionCollection());
        $this->writeLn("");
        $this->writeLn("<info>DONE</info>");
    }

    protected function ensureIndexes()
    {
        $this->getProgramsCollection()->getResourceModel()->getCollection();
        $this->getRangesCollection()->getResourceModel()->getCollection();
        $this->getLoyaltyNumberCollection()->getResourceModel()->getCollection();
        $this->getLFSBannerCollection()->getResourceModel()->getCollection();
        $this->getLFSPromotionCollection()->getResourceModel()->getCollection();
    }

    /**
     * @param \Petrosoft\LoyaltyBundle\Models\LoyaltyProgram\Collection $collection
     * @return int
     */
    protected function forEachProgram($collection)
    {
        $page = 1;
        $pageSize = $this->pageSize ? $this->pageSize : 1;
        $programs = null;

        $total = $collection->count();
        $pages = ceil($total/$pageSize);

        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyProgram\Collection $cloned */
        $cloned = $this->getCopy($collection);
        while ((is_null($programs) && $page == 1) || ($page <= $pages)) {
            $programs = $cloned->setPageSize($pageSize)->setPage($page);

            /** @var LoyaltyProgram $program */
            foreach ($programs as $program) {
                $accountId = $this->findAccountForProgram($program);
                if ($accountId) {
                    $program->setAccountId($accountId);
                    if (!$this->testMode) {
                        $program->save();
                    }

                    $this->updateRanges($program, $accountId);
                    $this->updateLoyaltyNumbers($program, $accountId);
                }
            }
            $countPage = $programs->getSize();
            $cloned = $this->getCopy($collection);
            $this->writeRotate((($page - 1) * $pageSize + $countPage), $total);
            ++$page;
        }
        if ($total) {
            $this->writeLn("", OutputInterface::VERBOSITY_VERBOSE);
        }

        return $total;
    }


    /**
     * @param MongoCollection $collection
     * @param callback $callback
     */
    protected function forEachModel($collection, $callback)
    {
        $page = 1;
        $pageSize = $this->pageSize ? $this->pageSize : 1;
        $models = null;

        $total = $collection->count();
        $pages = ceil($total/$pageSize);
        $argList = func_get_args();
        $args = array_slice($argList, 2);
        /** @var MongoCollection $cloned */
        $cloned = $this->getCopy($collection);
        while ((is_null($models) && $page == 1) || ($page <= $pages)) {
            $models = $cloned->setPageSize($pageSize)->setPage($page);

            /** @var Model $program */
            foreach ($models as $model) {
                $specArgs = $args;
                array_unshift($specArgs, $model);
                call_user_func_array($callback, $specArgs);
            }
            $cloned = $this->getCopy($collection);
            ++$page;
        }
    }

    protected function findAccountForProgram(LoyaltyProgram $program)
    {
        /** @var LoyaltyRange $range */
        $range = $this->getRangesCollection()
            ->addFieldToFilter('program_id', $program->getData('_id'))
            ->addFieldToFilter('account_id', true, 'exists')
            ->getFirstItem();

        return (int) $range->getData('account_id');
    }

    protected function updateRanges(LoyaltyProgram $program, $accountId)
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyRange\Collection $range */
        $ranges = $this->getRangesCollection()
            ->addFieldToFilter('program_id', $program->getData('_id'))
            ->addFieldToFilter('account_id', $accountId, 'neq');

        $this->forEachModel($ranges, $this->updateRangesCallback(), $accountId);
    }

    protected function updateRangesCallback()
    {
        $testMode = $this->testMode;

        return function (LoyaltyRange $range, $accountId) use ($testMode) {
            $range->setData('account_id', (int) $accountId);
            if (!$testMode) {
                $range->save();
            }
        };
    }

    protected function updateLoyaltyNumbers(LoyaltyProgram $program, $accountId)
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyNumber\Collection $numbers */
        $numbers = $this->getLoyaltyNumberCollection()
            ->addFieldToFilter('loyalty_program_id', $program->getData('_id'))
            ->addFieldToFilter('account_id', $accountId, 'neq');

        $this->forEachModel($numbers, $this->updateNumbersCallback(), $accountId);
    }

    protected function updateNumbersCallback()
    {
        $testMode = $this->testMode;

        return function (LoyaltyNumber $number, $accountId) use ($testMode) {
            $number->setData('account_id', (int) $accountId);
            if (!$testMode) {
                $number->save();
            }
        };
    }

    /**
     * @param \Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection $collection
     * @return int
     */
    protected function forEachPromo($collection)
    {
        $page = 1;
        $pageSize = $this->pageSize ? $this->pageSize : 1;
        $promotions = null;

        $total = $collection->count();
        $pages = ceil($total/$pageSize);
        /** @var \Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection $cloned */
        $cloned = $this->getCopy($collection);
        while ((is_null($promotions) && $page == 1) || ($page <= $pages)) {
            $promotions = $cloned->setPageSize($pageSize)->setPage($page);

            /** @var LFSPromotion $promotion */
            foreach ($promotions as $promotion) {
                $accountId = $this->findAccountForPromotion($promotion);
                if ($accountId) {
                    $promotion->setAccountId($accountId);
                    if (!$this->testMode) {
                        $promotion->save();
                    }

                    $this->updateBanner($promotion, $accountId);
                }
            }
            $countPage = $promotions->getSize();
            $this->writeRotate((($page - 1) * $pageSize + $countPage), $total);
            $cloned = $this->getCopy($collection);
            ++$page;
        }
        if ($total) {
            $this->writeLn("", OutputInterface::VERBOSITY_VERBOSE);
        }

        return $total;
    }

    protected function findAccountForPromotion(LFSPromotion $promotion)
    {
        $promoId = (int) $promotion->getData('promotion');


        $csoPromotion = $this->getCsoPromotionCollection()
            ->addFieldToFilter('id', $promoId)
            ->getFirstItem();

        if ($csoPromotion && !$csoPromotion->isObjectNew()) {
            return $csoPromotion->getData('AccountId');
        }

        return false;
    }

    protected function updateBanner(LFSPromotion $promotion, $accountId)
    {
        /** @var LFSBanner $banner */
        $banner = $this->getLFSBannerCollection()
            ->addFieldToFilter('lfs_promotion', $promotion->getData('_id'))
            ->getFirstItem();

        $banner->setAccountId($accountId);
        if (!$this->testMode && !$banner->isObjectNew()) {
            $banner->save();
        }
    }

    /** @return \Petrosoft\QwickServeBundle\Promotion\Collection */
    protected function getCsoPromotionCollection()
    {
        /** @var \Petrosoft\QwickServeBundle\Promotion\Collection $promotions */
        $promotions = $this->meetz->collection('QwickServe:Promotion');

        return $promotions->clear();
    }

    /** @return \Petrosoft\LoyaltyBundle\Models\LoyaltyProgram\Collection */
    protected function getProgramsCollection()
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyProgram\Collection $collection */
        $collection =  $this->meetz->collection('Loyalty:Models\LoyaltyProgram');

        return $collection->clear();
    }

    protected function getRangesCollection()
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyRange\Collection $collection */
        $collection =  $this->meetz->collection('Loyalty:Models\LoyaltyRange');

        return $collection->clear();
    }

    protected function getLoyaltyNumberCollection()
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LoyaltyNumber\Collection $collection */
        $collection =  $this->meetz->collection('Loyalty:Models\LoyaltyNumber');

        return $collection->clear();
    }

    protected function getLFSBannerCollection()
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LFSBanner\Collection $collection */
        $collection =  $this->meetz->collection('Loyalty:Models\LFSBanner');

        return $collection->clear();
    }

    /** @return \Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection */
    protected function getLFSPromotionCollection()
    {
        /** @var \Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection $collection */
        $collection =  $this->meetz->collection('Loyalty:Models\LFSPromotion');

        return $collection->clear();
    }

    protected function writeRotate($processed, $total)
    {
        $rotate = array('-', '\\', '|', '/');
        $output = $this->output;

        if ($output) {
            $left = ($this->rotatePointer++) % 4;
            $prepared = sprintf(
                "\r%2s :status (%s/%s)",
                $rotate[$left],
                $processed,
                $total
            );
            $this->write($prepared, OutputInterface::VERBOSITY_VERBOSE);

            if ($this->rotatePointer == 5) {
                $this->rotatePointer = 0;
            }
        }
    }

    protected function writeLn($data, $level = OutputInterface::VERBOSITY_NORMAL)
    {
        if ($this->output->getVerbosity() != OutputInterface::VERBOSITY_QUIET) {
            if ($this->output->getVerbosity() >= $level) {
                $this->output->writeln($data);
            }
        }
    }

    protected function write($data, $level = OutputInterface::VERBOSITY_NORMAL)
    {
        if ($this->output->getVerbosity() != OutputInterface::VERBOSITY_QUIET) {
            if ($this->output->getVerbosity() >= $level) {
                $this->output->write($data);
            }
        }
    }

    private function getCopy($model)
    {
        return clone $model;
    }
}
